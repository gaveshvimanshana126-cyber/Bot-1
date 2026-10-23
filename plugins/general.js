const { cmd } = require('../command');
const axios = require('axios');
const config = require('../config');
const { runtime } = require('../lib/functions');

// .ping
cmd({ pattern: 'ping', desc: 'Check bot speed', category: 'main', react: '🏓', filename: __filename },
async (danuwa, mek, m, { from, reply }) => {
  const start = Date.now();
  const sent = await reply('🏓 Pinging...');
  const ms = Date.now() - start;
  if (sent?.key) {
    await danuwa.sendMessage(from, { text: `🏓 *Pong!* ${ms} ms`, edit: sent.key });
  } else {
    await reply(`🏓 *Pong!* ${ms} ms`);
  }
});

// .runtime
cmd({ pattern: 'runtime', alias: ['uptime'], desc: 'How long the bot has been running', category: 'main', react: '⏱️', filename: __filename },
async (danuwa, mek, m, { reply }) => {
  reply(`⏱️ *Bot runtime:* ${runtime(process.uptime())}`);
});

// .owner
cmd({ pattern: 'owner', desc: 'Send the bot owner contact', category: 'main', react: '👑', filename: __filename },
async (danuwa, mek, m, { from }) => {
  const vcard =
    'BEGIN:VCARD\nVERSION:3.0\nFN:DANUWA-MD Owner\n' +
    `TEL;type=CELL;type=VOICE;waid=${config.BOT_OWNER}:+${config.BOT_OWNER}\nEND:VCARD`;
  await danuwa.sendMessage(from, { contacts: { displayName: 'Owner', contacts: [{ vcard }] } }, { quoted: mek });
});

// .time
cmd({ pattern: 'time', desc: 'Current time in Sri Lanka', category: 'main', react: '🕒', filename: __filename },
async (danuwa, mek, m, { reply }) => {
  const now = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Colombo', dateStyle: 'full', timeStyle: 'medium' });
  reply(`🕒 *Sri Lanka time:*\n${now}`);
});

// .say <text>
cmd({ pattern: 'say', alias: ['echo'], desc: 'Bot repeats your text', category: 'fun', react: '🗣️', filename: __filename },
async (danuwa, mek, m, { q, reply }) => {
  if (!q) return reply('❗ Usage: .say hello');
  reply(q);
});

// .joke
cmd({ pattern: 'joke', desc: 'Random joke', category: 'fun', react: '😂', filename: __filename },
async (danuwa, mek, m, { reply }) => {
  try {
    const { data } = await axios.get('https://official-joke-api.appspot.com/random_joke', { timeout: 10000 });
    reply(`😂 ${data.setup}\n\n👉 ${data.punchline}`);
  } catch {
    reply('❌ Could not get a joke right now. Try again.');
  }
});

// .weather <city>
cmd({ pattern: 'weather', desc: 'Weather of a city. Eg: .weather Colombo', category: 'tools', react: '🌤️', filename: __filename },
async (danuwa, mek, m, { q, reply }) => {
  if (!q) return reply('❗ Usage: .weather Colombo');
  try {
    const { data } = await axios.get(`https://wttr.in/${encodeURIComponent(q)}?format=3`, { timeout: 10000 });
    reply(`🌤️ ${String(data).trim()}`);
  } catch {
    reply('❌ City not found or weather service is down.');
  }
});

// .calc <expression>  (safe: digits and + - * / ( ) . % only)
cmd({ pattern: 'calc', desc: 'Calculator. Eg: .calc 5*(3+2)', category: 'tools', react: '🧮', filename: __filename },
async (danuwa, mek, m, { q, reply }) => {
  if (!q) return reply('❗ Usage: .calc 12*5+3');
  if (!/^[0-9+\-*/().%\s]+$/.test(q)) return reply('❌ Only numbers and + - * / ( ) % are allowed.');
  try {
    const result = Function(`"use strict"; return (${q})`)();
    if (!Number.isFinite(result)) return reply('❌ Invalid calculation.');
    reply(`🧮 ${q} = *${result}*`);
  } catch {
    reply('❌ Invalid expression.');
  }
});
