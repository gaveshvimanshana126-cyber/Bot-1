const os = require('os');
const { cmd, commands } = require('../command');
const config = require('../config');
const { runtime } = require('../lib/functions');

const LINE = '━━━━━━━━━━━━━━━━━━━━';
const FOOTER = `\n\n${LINE}\n*🤖 ${config.BOT_NAME}*\n> ⚡ Created by ${config.CREATOR}`;

const TZ = 'Asia/Colombo';

function greeting() {
  const hour = Number(new Date().toLocaleString('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false })) % 24;
  if (hour >= 5 && hour < 12) return 'Good Morning ☀️';
  if (hour >= 12 && hour < 17) return 'Good Afternoon 🌤️';
  if (hour >= 17 && hour < 21) return 'Good Evening 🌇';
  return 'Good Night 🌙';
}

const row = (icon, label, value) => `│ ${icon} *${label}:* ${value}`;

cmd({
  pattern: 'alive',
  alias: ['bot', 'online'],
  desc: 'Check bot online or no.',
  category: 'main',
  react: '⚡',
  filename: __filename,
},
async (danuwa, mek, m, { from, pushname, reply }) => {
  try {
    // response speed = how long the message took to reach the bot
    const sentAt = Number(mek.messageTimestamp?.low ?? mek.messageTimestamp) * 1000;
    const speed = sentAt ? Math.max(0, Date.now() - sentAt) : null;

    const time = new Date().toLocaleTimeString('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true });
    const date = new Date().toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
    const ram = (process.memoryUsage().rss / 1024 / 1024).toFixed(0);
    const totalRam = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1);
    const platform = process.env.GITHUB_ACTIONS ? 'GitHub Actions' : process.env.DYNO ? 'Heroku' : os.platform();

    const intro = config.ALIVE_MSG || `I'm alive and running smoothly 😎`;

    const caption =
`╭─「 🤖 *${config.BOT_NAME}* 」
│
│ 👋 ${greeting()}, *${pushname || 'friend'}*!
│ ✅ ${intro}
│
${row('⏱️', 'Uptime', runtime(process.uptime()).replace(/,\s*$/, '') || '0 seconds')}
${speed !== null ? row('⚡', 'Speed', `${speed} ms`) + '\n' : ''}${row('🕒', 'Time', time)}
${row('📅', 'Date', date)}
│
${row('🧩', 'Commands', commands.length)}
${row('🔰', 'Prefix', config.PREFIX)}
${row('💾', 'RAM', `${ram} MB / ${totalRam} GB`)}
${row('🖥️', 'Platform', platform)}
${row('🟢', 'Node', process.version)}
│
${row('👑', 'Owner', `wa.me/${config.BOT_OWNER}`)}
│
╰──────────────────

💡 _Type *${config.PREFIX}menu* to see all commands_${FOOTER}`;

    return await danuwa.sendMessage(from, {
      image: { url: config.ALIVE_IMG },
      caption,
    }, { quoted: mek });
  } catch (e) {
    console.log(e);
    reply(`❌ ${e.message}`);
  }
});
