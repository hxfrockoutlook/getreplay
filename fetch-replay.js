const axios = require('axios');
const crypto =require('crypto');
const fs = require('fs').promises;
const path = require('path');

// 设置时区为 Asia/Shanghai
process.env.TZ = 'Asia/Shanghai';

// 解析命令行参数
function parseArgs() {
  const args = process.argv.slice(2);
  let days = 3;          // 默认3天
  let output = 'replay.json'; // 默认输出文件

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--days' && i + 1 < args.length) {
      days = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--output' && i + 1 < args.length) {
      output = args[i + 1];
      i++;
    } else if (args[i].startsWith('--days=')) {
      days = parseInt(args[i].split('=')[1], 10);
    } else if (args[i].startsWith('--output=')) {
      output = args[i].split('=')[1];
    }
  }
  return { days, output };
}

const { days, output } = parseArgs();
console.log(`运行模式：days=${days}, output=${output}`);

// 目标联赛
const targetLeagues = [
  'NBA', 'NBA发展联盟', '英超', '德甲', '西甲', '意甲', '法甲', '欧冠', '欧联杯',
  '欧足联', '英冠', 'CBA', '中NBL', '欧篮联', '世亚预', '美冠杯', '沙特超', '超级杯', '女亚洲杯'
];

// ---------- 修改开始：基于上海时区的日期范围生成 ----------
// 获取当前上海日期（YYYY-MM-DD）
function getTodayShanghai() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(now);
}

// 从上海日期字符串减去 offset 天，返回新的上海日期字符串
function subtractShanghaiDays(dateStr, offset) {
  const [year, month, day] = dateStr.split('-').map(Number);
  // 构建 UTC 时间的该日期中午（避免时区边界问题）
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  date.setUTCDate(date.getUTCDate() - offset);
  // 格式化为上海日期
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(date);
}

// 生成日期范围 (今天及往前 days-1 天)
function getDateRange(days) {
  const range = [];
  const todayStr = getTodayShanghai(); // 例如 "2026-03-05"
  for (let i = 0; i < days; i++) {
    range.push(subtractShanghaiDays(todayStr, i)); // i=0 今天，i=1 昨天，i=2 前天
  }
  return range;
}
// ---------- 修改结束 ----------

const dateRange = getDateRange(days);
console.log('日期范围:', dateRange);

// 数字转中文 (1 -> 一, 2 -> 二, ...)
function numberToChinese(num) {
  const map = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  return map[num - 1] || String(num);
}

// 通用请求函数
async function fetchJson(url, headers = {}) {
  try {
    const response = await axios.get(url, { headers, timeout: 10000 });
    return response.data;
  } catch (error) {
    console.error(`请求失败: ${url}`, error.message);
    return null;
  }
}

// 主函数
async function main() {
  // 第一步：获取比赛列表
  const listUrl = 'https://kafeizhibo.com/api/v1/recordings?page=1&size=600';
  const listHeaders = {
    'sec-ch-ua-platform': '"Windows"',
    'Referer': 'https://kafeizhibo.com/pc/replay',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36...',
    'sec-ch-ua': '"Not:A-Brand";v="99"...',
    'sec-ch-ua-mobile': '?0'
  };

  const listData = await fetchJson(listUrl, listHeaders);
  if (!listData || listData.code !== 200) {
    console.error('无法获取列表或API异常');
    process.exit(1);
  }

  const matchesBase = [];
  for (const item of listData.data) {
    if (!targetLeagues.includes(item.league_name)) continue;

    const startDate = item.start_time.slice(0, 10);
    if (!dateRange.includes(startDate)) continue;

    // 解析开始时间并格式化为 MM月DD日HH:MM (例如 03月04日08:00)
    const dt = new Date(item.start_time.replace(' ', 'T') + ':00+08:00'); // 假设原时间为北京时间
    if (isNaN(dt.getTime())) continue;
    const month = (dt.getMonth() + 1).toString().padStart(2, '0');
    const day = dt.getDate().toString().padStart(2, '0');
    const hours = dt.getHours().toString().padStart(2, '0');
    const minutes = dt.getMinutes().toString().padStart(2, '0');
    const datetime = `${month}月${day}日${hours}:${minutes}`;

    const pkInfoTitle = `${item.home_team}VS${item.away_team}`;
    const pID = crypto.createHash('md5').update(item.league_name + datetime + pkInfoTitle).digest('hex');

    matchesBase.push({
      mgdbId: item.match_id,
      pID,
      title: `${item.league_name} ${item.home_score}:${item.away_score}`,
      keyword: datetime,
      sportItemId: String(item.type),
      matchStatus: '2',
      matchField: '',
      competitionName: item.league_name,
      padImg: item.home_team_logo,
      competitionLogo: '',
      pkInfoTitle,
      modifyTitle: '',
      presenters: '',
      matchInfo: { time: datetime },
      // 保存 recording_count 供后续使用
      recordingCount: item.recording_count || 0
    });
  }

  console.log(`基础比赛数量: ${matchesBase.length}`);

  // 第二步：获取详细回放
  const finalMatches = [];
  for (const match of matchesBase) {
    let nodes = [];

    if (days === 1) {
      // today 模式：请求详情接口获取真实播放地址
      const detailUrl = `https://kafeizhibo.com/api/v1/match/${match.mgdbId}/recordings`;
      const detailHeaders = {
        'sec-ch-ua-platform': '"Windows"',
        'Referer': `https://kafeizhibo.com/pc/recording/${match.mgdbId}`,
        'User-Agent': 'Mozilla/5.0...',
        'sec-ch-ua': '...',
        'sec-ch-ua-mobile': '?0'
      };

      const detailData = await fetchJson(detailUrl, detailHeaders);
      if (!detailData || detailData.code !== 200 || !detailData.data?.replays?.length) continue;

      let idx = 1;
      for (const replay of detailData.data.replays) {
        nodes.push({
          name: `${replay.title}(${numberToChinese(idx)})`,
          url: [replay.video_url]
        });
        idx++;
      }
    } else {
      // all 模式：根据 recording_count 生成固定格式的节点
      const count = match.recordingCount;
      if (count > 0) {
        // 固定名称数组
        const nameTemplates = ['高清回放', '超清中文', '超清外语'];
        for (let i = 0; i < Math.min(count, 3); i++) {
          nodes.push({
            name: `${nameTemplates[i]}(${numberToChinese(i + 1)})`,
            url: [`https://miguvideo.hxfrock.ggff.net/api/player?flag=88看球回放&pid=${match.mgdbId}_${i}`]
          });
        }
      } else {
        continue; // 没有回放，跳过该比赛
      }
    }

    if (nodes.length > 0) {
      match.nodes = nodes;
      // 无论哪种模式，最终输出前删除 recordingCount 字段
      delete match.recordingCount;
      finalMatches.push(match);
    }
  }

  console.log(`最终比赛数量: ${finalMatches.length}`);

  // 写入文件
  const outputPath = path.join(__dirname, output);
  await fs.writeFile(outputPath, JSON.stringify(finalMatches, null, 2), 'utf8');
  console.log(`文件已保存: ${outputPath}`);
}

main().catch(err => {
  console.error('脚本运行失败:', err);
  process.exit(1);
});
