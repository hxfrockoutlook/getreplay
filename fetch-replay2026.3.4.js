const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

// 设置时区为 Asia/Shanghai
process.env.TZ = 'Asia/Shanghai';

// 目标联赛
const targetLeagues = [
  'NBA', 'NBA发展联盟', '英超', '德甲', '西甲', '意甲', '法甲', '欧冠', '欧联杯',
  '欧足联', '英冠', 'CBA', '中NBL', '欧篮联', '世亚预', '美冠杯', '沙特超', '超级杯'
];

// 获取三天内的日期 (今天、昨天、前天)
const today = new Date();
const yesterday = new Date(today);
yesterday.setDate(today.getDate() - 1);
const dayBeforeYesterday = new Date(today);
dayBeforeYesterday.setDate(today.getDate() - 2);

const dateRange = [
  today.toISOString().slice(0, 10),
  yesterday.toISOString().slice(0, 10),
  dayBeforeYesterday.toISOString().slice(0, 10)
];

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

    // 解析开始时间并格式化为 m月d日H:i (例如 04月05日14:30)
    const dt = new Date(item.start_time.replace(' ', 'T') + ':00+08:00'); // 假设原时间为北京时间
    if (isNaN(dt.getTime())) continue;
    const month = dt.getMonth() + 1;
    const day = dt.getDate();
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
      matchInfo: { time: datetime }
    });
  }

  console.log(`基础比赛数量: ${matchesBase.length}`);

  // 第二步：获取详细回放
  const finalMatches = [];
  for (const match of matchesBase) {
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

    const nodes = [];
    let idx = 1;
    for (const replay of detailData.data.replays) {
      nodes.push({
        name: `${replay.title}(${numberToChinese(idx)})`,
        url: [replay.video_url]
      });
      idx++;
    }
    match.nodes = nodes;
    finalMatches.push(match);
  }

  console.log(`最终比赛数量: ${finalMatches.length}`);

  // 写入文件
  const outputPath = path.join(__dirname, 'replay.json');
  await fs.writeFile(outputPath, JSON.stringify(finalMatches, null, 2), 'utf8');
  console.log(`文件已保存: ${outputPath}`);
}

main().catch(err => {
  console.error('脚本运行失败:', err);
  process.exit(1);
});
