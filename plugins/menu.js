const { cmd, commands } = require('../command');
const config = require('../config');
const { runtime } = require('../lib/functions');

const P = config.PREFIX;
const LINE = '━━━━━━━━━━━━━━━━━━━━';
const FOOTER = `\n\n${LINE}\n*🤖 ${config.BOT_NAME}*\n> ⚡ Created by ${config.CREATOR}`;
const TZ = 'Asia/Colombo';
const CAPTION_LIMIT = 2000;          // longer -> image + text sent as two messages
const SESSION_TTL = 60 * 60 * 1000;  // a menu message stays "clickable" for 1 hour
const MAX_SESSIONS = 300;

const CATEGORY_STYLE = {
  main: ['🏠', 'MAIN'],
  tools: ['🛠️', 'TOOLS'],
  fun: ['🎉', 'FUN'],
  download: ['📥', 'DOWNLOAD'],
  group: ['👥', 'GROUP'],
  misc: ['📦', 'MISC'],
};
const ORDER = ['main', 'tools', 'download', 'fun', 'group', 'misc'];
const styleOf = (cat) => CATEGORY_STYLE[cat] || ['📁', cat.toUpperCase()];

function greeting() {
  const hour = Number(new Date().toLocaleString('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false })) % 24;
  if (hour >= 5 && hour < 12) return 'Good Morning ☀️';
  if (hour >= 12 && hour < 17) return 'Good Afternoon 🌤️';
  if (hour >= 17 && hour < 21) return 'Good Evening 🌇';
  return 'Good Night 🌙';
}

// { groups: {category: [cmd...]}, cats: [ordered category names] }
function groupCommands() {
  const groups = {};
  for (const c of commands) {
    if (c.dontAddCommandList || !c.pattern) continue;
    const cat = (c.category || 'misc').toLowerCase();
    (groups[cat] = groups[cat] || []).push(c);
  }
  const cats = Object.keys(groups).sort((a, b) => {
    const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
  return { groups, cats };
}

// ---------- pieces of the design ----------
const botCard = (pushname, total) =>
`╭─「 🤖 *${config.BOT_NAME}* 」
│
│ 👋 ${greeting()}, *${pushname || 'friend'}*!
│
│ ⏱️ *Uptime:* ${runtime(process.uptime()).replace(/,\s*$/, '') || '0 seconds'}
│ 🔰 *Prefix:* ${P}
│ 🧩 *Commands:* ${total}
│ 👑 *Owner:* wa.me/${config.BOT_OWNER}
│
╰──────────────────`;

const categoryListCard = (cats, groups) => {
  const rows = cats.map((c, i) => {
    const [icon, title] = styleOf(c);
    return `│ *${i + 1}* ❯ ${icon} ${title} _(${groups[c].length})_`;
  });
  return `╭─「 📂 *MENU CATEGORIES* 」\n│\n${rows.join('\n')}\n│\n╰──────────────────`;
};

const commandsCard = (cat, list) => {
  const [icon, title] = styleOf(cat);
  const rows = list
    .slice()
    .sort((a, b) => a.pattern.localeCompare(b.pattern))
    .map((c) => {
      const alias = c.alias && c.alias.length ? ` _(${c.alias.map((a) => P + a).join(', ')})_` : '';
      return `│ ➤ *${P}${c.pattern}*${alias}\n│    ${c.desc || 'No description'}`;
    });
  return `╭─「 ${icon} *${title}* (${list.length}) 」\n│\n${rows.join('\n')}\n│\n╰──────────────────`;
};

// ---------- sending (image + caption, with safe fallbacks) ----------
// returns the message that carries the first part (that's the one people reply to)
async function sendWithImage(danuwa, from, mek, head, rest = '') {
  const image = { url: config.MENU_IMG };
  const full = rest ? `${head}\n\n${rest}` : head;
  try {
    if (full.length <= CAPTION_LIMIT) {
      return await danuwa.sendMessage(from, { image, caption: full }, { quoted: mek });
    }
    const first = await danuwa.sendMessage(from, { image, caption: head + FOOTER }, { quoted: mek });
    await danuwa.sendMessage(from, { text: rest + FOOTER }, { quoted: mek });
    return first;
  } catch (e) {
    console.error('Menu image failed, sending text only:', e.message);
    return await danuwa.sendMessage(from, { text: full }, { quoted: mek });
  }
}

// ---------- reply sessions: menu message id -> categories ----------
// NOT removed after use -> the same menu message can be replied to again and again
const sessions = new Map();
function addSession(id, cats) {
  if (!id) return;
  const now = Date.now();
  for (const [k, v] of sessions) if (v.expires < now) sessions.delete(k);
  while (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
  sessions.set(id, { cats, expires: now + SESSION_TTL });
}
const quotedIdOf = (mek) => mek?.message?.extendedTextMessage?.contextInfo?.stanzaId;

async function sendMainMenu(danuwa, from, mek, pushname) {
  const { groups, cats } = groupCommands();
  const total = cats.reduce((n, c) => n + groups[c].length, 0);
  const head = botCard(pushname, total);
  const rest =
    `${categoryListCard(cats, groups)}\n\n` +
    `👇 _Reply to this message with a number_\n_Eg: *1* — you can reply as many times as you like_${FOOTER}`;
  const sent = await sendWithImage(danuwa, from, mek, head, rest);
  addSession(sent?.key?.id, cats);
}

async function sendCategory(danuwa, from, mek, pushname, cat) {
  const { groups } = groupCommands();
  const total = Object.values(groups).reduce((n, l) => n + l.length, 0);
  const head = botCard(pushname, total);
  const rest = `${commandsCard(cat, groups[cat])}\n\n↩️ _Reply another number to the menu message, or type *${P}menu*_${FOOTER}`;
  await sendWithImage(danuwa, from, mek, head, rest);
}

// ---------- .menu ----------
cmd({
  pattern: 'menu',
  alias: ['help', 'list', 'commands'],
  desc: 'Show all commands. Eg: .menu  |  .menu group  |  .menu kick',
  category: 'main',
  react: '📜',
  filename: __filename,
},
async (danuwa, mek, m, { from, q, pushname, reply }) => {
  try {
    const { groups, cats } = groupCommands();
    let query = (q || '').trim().toLowerCase().replace(new RegExp('^\\' + P), '');

    if (/^\d+$/.test(query) && cats[Number(query) - 1]) query = cats[Number(query) - 1]; // .menu 2

    if (query && groups[query]) return sendCategory(danuwa, from, mek, pushname, query);

    if (query) {
      const c = commands.find((x) => x.pattern === query || (x.alias && x.alias.includes(query)));
      if (!c) return reply(`❌ No command or category called *${query}*.\n\n📂 Categories: ${cats.join(', ')}\n💡 Type *${P}menu* to see everything.`);
      const rows = [
        `│ 🔹 *Command:* ${P}${c.pattern}`,
        c.alias && c.alias.length ? `│ 🔸 *Aliases:* ${c.alias.map((a) => P + a).join(', ')}` : null,
        `│ 📂 *Category:* ${c.category}`,
        `│ 📝 *About:* ${c.desc || 'No description'}`,
      ].filter(Boolean);
      return reply(`╭─「 ℹ️ *COMMAND INFO* 」\n│\n${rows.join('\n')}\n│\n╰──────────────────` + FOOTER);
    }

    await sendMainMenu(danuwa, from, mek, pushname);
  } catch (err) {
    console.error(err);
    reply('❌ Error generating menu.');
  }
});

// ---------- reply handler: "1", "2"... sent as a reply to a menu message ----------
cmd({
  filter: (body, { message }) => {
    const id = quotedIdOf(message);
    const s = id && sessions.get(id);
    return !!(s && s.expires > Date.now() && /^\s*\d+\s*$/.test(body || ''));
  },
  filename: __filename,
},
async (danuwa, mek, m, { from, body, pushname, reply }) => {
  try {
    const id = quotedIdOf(mek);
    const s = sessions.get(id);
    const n = parseInt(body, 10);
    s.expires = Date.now() + SESSION_TTL; // still being used -> keep it alive

    if (n === 0) return sendMainMenu(danuwa, from, mek, pushname); // 0 = back to the main menu
    const cat = s.cats[n - 1];
    if (!cat) return reply(`⚠️ *Invalid choice!* Pick a number from 1 to ${s.cats.length}.`);

    await sendCategory(danuwa, from, mek, pushname, cat);
  } catch (e) {
    console.error('Menu reply error:', e);
  }
});
