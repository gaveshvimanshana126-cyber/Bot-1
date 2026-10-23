const { cmd } = require('../command');
const axios = require('axios');
const crypto = require('crypto');
const config = require('../config');

const P = config.PREFIX;
const LINE = '━━━━━━━━━━━━━━━━━━━━';
const FOOTER = `\n\n${LINE}\n*🤖 ${config.BOT_NAME}*\n> ⚡ Created by ${config.CREATOR}`;
const http = (url, opt = {}) => axios.get(url, { timeout: 15000, ...opt });

const card = (icon, title, rows = []) =>
  `╭─「 ${icon} *${title}* 」\n│\n${rows.filter(Boolean).map((r) => (r === '│' ? r : '│ ' + r)).join('\n')}\n│\n╰──────────────────`;

// text of the message you replied to
const quotedText = (m) => {
  const msg = m.quoted?.msg;
  return typeof msg === 'string' ? msg : msg?.text || msg?.caption || '';
};

// ---------------- .dp  (profile picture) ----------------
cmd({ pattern: 'dp', alias: ['pp'], desc: 'Get profile picture. Reply/@mention someone', category: 'tools', react: '🖼️', filename: __filename },
async (danuwa, mek, m, { from, sender, isGroup, reply }) => {
  const target = m.mentionUser?.[0] || (isGroup ? sender : from);
  try {
    const url = await danuwa.profilePictureUrl(target, 'image');
    await danuwa.sendMessage(from, { image: { url }, caption: `🖼️ @${target.split('@')[0]}${FOOTER}`, mentions: [target] }, { quoted: mek });
  } catch {
    reply('❌ No profile picture found (or the person hides it).');
  }
});

// ---------------- .qr <text> ----------------
cmd({ pattern: 'qr', desc: 'Make a QR code. Eg: .qr https://google.com', category: 'tools', react: '🔳', filename: __filename },
async (danuwa, mek, m, { from, q, reply }) => {
  const text = q || quotedText(m);
  if (!text) return reply(`❗ Usage: ${P}qr <text or link>`);
  await danuwa.sendMessage(from, {
    image: { url: `https://api.qrserver.com/v1/create-qr-code/?size=600x600&margin=10&data=${encodeURIComponent(text)}` },
    caption: `🔳 *QR Code*\n_${text.slice(0, 100)}_${FOOTER}`,
  }, { quoted: mek });
});

// ---------------- .tr <lang> <text>  (translate) ----------------
cmd({ pattern: 'tr', alias: ['translate'], desc: 'Translate. Eg: .tr si hello  |  reply + .tr en', category: 'tools', react: '🌐', filename: __filename },
async (danuwa, mek, m, { args, reply }) => {
  const replied = quotedText(m);
  let lang, text;
  if (replied) { lang = args[0] || 'si'; text = replied; }
  else if (args.length >= 2) { lang = args[0]; text = args.slice(1).join(' '); }
  else return reply(`❗ Usage:\n• ${P}tr si how are you\n• reply to a message + ${P}tr en\n\n_si = Sinhala, en = English, ta = Tamil, hi = Hindi_`);

  try {
    const { data } = await http('https://api.mymemory.translated.net/get', { params: { q: text.slice(0, 450), langpair: `Autodetect|${lang}` } });
    const out = data?.responseData?.translatedText;
    if (!out || data.responseStatus && Number(data.responseStatus) !== 200) throw new Error('bad response');
    reply(card('🌐', 'TRANSLATE', [`📝 ${text.slice(0, 120)}`, '│', `➡️ *${lang.toUpperCase()}:* ${out}`]) + FOOTER);
  } catch {
    reply('❌ Translation failed. Check the language code (si, en, ta, hi...) and try again.');
  }
});

// ---------------- .define <word> ----------------
cmd({ pattern: 'define', alias: ['dict'], desc: 'English dictionary. Eg: .define serendipity', category: 'tools', react: '📖', filename: __filename },
async (danuwa, mek, m, { q, reply }) => {
  if (!q) return reply(`❗ Usage: ${P}define <word>`);
  try {
    const { data } = await http(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(q.split(' ')[0])}`);
    const e = data[0];
    const rows = [`📖 *${e.word}* ${e.phonetic || ''}`];
    e.meanings.slice(0, 2).forEach((mn) => {
      const d = mn.definitions[0];
      rows.push('│', `🏷️ _${mn.partOfSpeech}_`, `• ${d.definition}`);
      if (d.example) rows.push(`💬 _${d.example}_`);
    });
    reply(card('📚', 'DICTIONARY', rows) + FOOTER);
  } catch {
    reply('❌ Word not found.');
  }
});

// ---------------- .currency 100 usd lkr ----------------
cmd({ pattern: 'currency', alias: ['cur', 'convert'], desc: 'Convert money. Eg: .currency 100 usd lkr', category: 'tools', react: '💱', filename: __filename },
async (danuwa, mek, m, { args, reply }) => {
  const amount = parseFloat(args[0]);
  const from = (args[1] || '').toUpperCase();
  const to = (args[2] || 'LKR').toUpperCase();
  if (isNaN(amount) || !/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) return reply(`❗ Usage: ${P}currency 100 usd lkr`);
  try {
    const { data } = await http(`https://open.er-api.com/v6/latest/${from}`);
    const rate = data?.rates?.[to];
    if (!rate) throw new Error('unknown currency');
    const fmt = (n) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
    reply(card('💱', 'CURRENCY', [`💵 ${fmt(amount)} ${from}`, `➡️ *${fmt(amount * rate)} ${to}*`, '│', `📈 1 ${from} = ${rate} ${to}`]) + FOOTER);
  } catch {
    reply('❌ Unknown currency code or the service is down.');
  }
});

// ---------------- .short <url> ----------------
cmd({ pattern: 'short', alias: ['tinyurl'], desc: 'Shorten a link', category: 'tools', react: '🔗', filename: __filename },
async (danuwa, mek, m, { q, reply }) => {
  if (!/^https?:\/\//i.test(q || '')) return reply(`❗ Usage: ${P}short https://very-long-link.com/...`);
  try {
    const { data } = await http('https://tinyurl.com/api-create.php', { params: { url: q } });
    reply(`🔗 *Short link:*\n${String(data).trim()}${FOOTER}`);
  } catch {
    reply('❌ Could not shorten that link.');
  }
});

// ---------------- .password [length] (sent privately) ----------------
cmd({ pattern: 'password', alias: ['pass'], desc: 'Strong random password (sent to your DM)', category: 'tools', react: '🔐', filename: __filename },
async (danuwa, mek, m, { args, sender, isGroup, reply }) => {
  const len = Math.min(Math.max(parseInt(args[0]) || 14, 8), 64);
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*?';
  let pw = '';
  for (let i = 0; i < len; i++) pw += chars[crypto.randomInt(chars.length)];
  await danuwa.sendMessage(sender, { text: `🔐 *Your password (${len}):*\n\n${pw}\n\n_Save it somewhere safe._` });
  if (isGroup) reply('🔐 Password sent to your private chat.');
});

// ---------------- fun ----------------
cmd({ pattern: 'flip', desc: 'Flip a coin', category: 'fun', react: '🪙', filename: __filename },
async (danuwa, mek, m, { reply }) => reply(`🪙 *${crypto.randomInt(2) ? 'HEADS' : 'TAILS'}*`));

cmd({ pattern: 'dice', alias: ['roll'], desc: 'Roll a dice', category: 'fun', react: '🎲', filename: __filename },
async (danuwa, mek, m, { reply }) => reply(`🎲 You rolled a *${crypto.randomInt(1, 7)}*`));

const BALL = ['Yes, definitely 😎', 'It is certain ✅', 'Most likely 👍', 'Ask again later 🤔', "Can't say right now 🌫️", "Don't count on it 😬", 'My answer is no ❌', 'Very doubtful 🙅'];
cmd({ pattern: '8ball', desc: 'Ask the magic 8-ball. Eg: .8ball will I pass?', category: 'fun', react: '🎱', filename: __filename },
async (danuwa, mek, m, { q, reply }) => {
  if (!q) return reply(`❗ Ask a question. Eg: ${P}8ball will I pass?`);
  reply(`🎱 *${q}*\n\n➡️ ${BALL[crypto.randomInt(BALL.length)]}`);
});
