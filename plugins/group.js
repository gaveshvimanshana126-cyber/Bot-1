// plugins/group.js  —  Anti-Delete + Group management
// Needs ONE line added in index.js (see bottom of this file).

const fs = require('fs');
const path = require('path');
const { downloadMediaMessage, jidNormalizedUser } = require('@whiskeysockets/baileys');
const P = require('pino');
const { cmd } = require('../command');
const config = require('../config');

// ───────────────────────── settings (saved in data/group-settings.json) ─────────────────────────
const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'group-settings.json');

function envMode() {
  const v = String(process.env.ANTI_DELETE || '').toLowerCase();
  if (v === 'true' || v === 'chat') return 'chat';
  if (v === 'owner') return 'owner';
  return 'off';
}

let settings = { antidelete: envMode(), groups: {} };
try {
  if (fs.existsSync(FILE)) settings = { ...settings, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
} catch (e) { console.error('[group.js] settings load failed:', e.message); }

// ---------- Firebase Realtime Database (optional, via REST) ----------
// env: FIREBASE_DB_URL = https://<project>-default-rtdb.<region>.firebasedatabase.app
//      FIREBASE_SECRET = database secret (optional, if your rules are not public)
const axios = require('axios');
const FB_URL = (process.env.FIREBASE_DB_URL || 'https://sutable-99848-default-rtdb.firebaseio.com').replace(/\/+$/, '');
const FB_SECRET = process.env.FIREBASE_SECRET || '';
const fbEndpoint = () => `${FB_URL}/danuwa_group_settings.json${FB_SECRET ? `?auth=${FB_SECRET}` : ''}`;

// JIDs contain "." which Firebase forbids in keys, so the whole object is stored as one JSON string.
async function loadRemote() {
  if (!FB_URL) return;
  try {
    const { data } = await axios.get(fbEndpoint(), { timeout: 10000 });
    if (data?.json) {
      const remote = JSON.parse(data.json);
      settings = { ...settings, ...remote, groups: { ...settings.groups, ...remote.groups } };
      console.log('🔥 Settings loaded from Firebase');
    }
  } catch (e) { console.error('[group.js] Firebase load failed:', e.message); }
}
loadRemote();

let saveTimer = null;
function pushRemote() {
  if (!FB_URL) return;
  clearTimeout(saveTimer); // debounce: many quick changes -> one write
  saveTimer = setTimeout(() => {
    axios.put(fbEndpoint(), { json: JSON.stringify(settings) }, { timeout: 10000 })
      .catch((e) => console.error('[group.js] Firebase save failed:', e.message));
  }, 1500);
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(settings, null, 2));
  } catch (e) { console.error('[group.js] local save failed:', e.message); }
  pushRemote();
}
const gs = (jid) => (settings.groups[jid] ||= { antilink: false, welcome: false });

// ───────────────────────── helpers ─────────────────────────
const WRAPPERS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage'];
const unwrap = (message) => {
  let msg = message;
  for (let i = 0; i < 5 && msg; i++) {
    const w = WRAPPERS.find((k) => msg[k]?.message);
    if (!w) break;
    msg = msg[w].message;
  }
  return msg;
};

const textOf = (msg) =>
  msg?.conversation ||
  msg?.extendedTextMessage?.text ||
  msg?.imageMessage?.caption ||
  msg?.videoMessage?.caption ||
  msg?.documentMessage?.caption ||
  '';

const MEDIA = ['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage'];
const num = (jid) => String(jid || '').split('@')[0].split(':')[0];
const toJid = (n) => `${String(n).replace(/\D/g, '')}@s.whatsapp.net`;

function getTargets(mek, q) {
  const ctx = unwrap(mek.message)?.extendedTextMessage?.contextInfo;
  const list = [...(ctx?.mentionedJid || [])];
  if (!list.length && ctx?.participant) list.push(ctx.participant);
  if (!list.length && q) {
    const n = q.replace(/\D/g, '');
    if (n.length >= 7) list.push(toJid(n));
  }
  return [...new Set(list.map((j) => jidNormalizedUser(j)))];
}

// common checks. returns true if OK to continue
function guard({ isGroup, isAdmins, isBotAdmins, isOwner, reply }, { admin = true, botAdmin = true } = {}) {
  if (!isGroup) { reply('❌ This command only works in groups.'); return false; }
  if (admin && !(isAdmins || isOwner)) { reply('❌ Only group admins can use this.'); return false; }
  if (botAdmin && !isBotAdmins) { reply('❌ Make the bot a group admin first.'); return false; }
  return true;
}

// ───────────────────────── ANTI-DELETE ─────────────────────────
const cache = new Map();           // "chat:id" -> message
const CACHE_MAX = 3000;

function remember(mek) {
  if (!mek?.message || !mek.key?.id) return;
  if (mek.key.remoteJid === 'status@broadcast') return;
  const k = `${mek.key.remoteJid}:${mek.key.id}`;
  cache.set(k, mek);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value); // drop oldest
}

async function recover(sock, chat, deletedId, deletedBy) {
  if (settings.antidelete === 'off') return;
  const original = cache.get(`${chat}:${deletedId}`);
  if (!original || original.key.fromMe) return;

  const msg = unwrap(original.message);
  const isGroup = chat.endsWith('@g.us');
  const author = original.key.participant || original.key.remoteJid;
  const remover = deletedBy || author;

  let where = chat;
  if (settings.antidelete === 'owner') where = toJid(config.BOT_OWNER);

  let chatName = '';
  if (isGroup) chatName = (await sock.groupMetadata(chat).catch(() => null))?.subject || '';

  const header =
    `🗑️ *ANTI-DELETE*\n` +
    `👤 *Sender:* @${num(author)}\n` +
    (remover !== author ? `🧹 *Deleted by:* @${num(remover)}\n` : '') +
    (isGroup ? `👥 *Group:* ${chatName}\n` : `💬 *Private chat*\n`) +
    `🕒 *Time:* ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Colombo' })}`;
  const mentions = [author, remover].filter(Boolean);

  try {
    const type = MEDIA.find((t) => msg[t]);
    const text = textOf(msg);

    if (!type) {
      if (!text) return;
      return void (await sock.sendMessage(where, { text: `${header}\n\n📝 *Message:*\n${text}`, mentions }));
    }

    const buffer = await downloadMediaMessage(
      { key: original.key, message: msg }, 'buffer', {}, { logger: P({ level: 'silent' }) }
    );

    if (type === 'imageMessage')
      await sock.sendMessage(where, { image: buffer, caption: `${header}${text ? `\n\n📝 ${text}` : ''}`, mentions });
    else if (type === 'videoMessage')
      await sock.sendMessage(where, { video: buffer, caption: `${header}${text ? `\n\n📝 ${text}` : ''}`, mentions });
    else if (type === 'documentMessage')
      await sock.sendMessage(where, {
        document: buffer,
        mimetype: msg.documentMessage.mimetype,
        fileName: msg.documentMessage.fileName || 'file',
        caption: header, mentions,
      });
    else if (type === 'audioMessage') {
      await sock.sendMessage(where, { text: header, mentions });
      await sock.sendMessage(where, { audio: buffer, mimetype: msg.audioMessage.mimetype || 'audio/mpeg', ptt: !!msg.audioMessage.ptt });
    } else if (type === 'stickerMessage') {
      await sock.sendMessage(where, { text: header, mentions });
      await sock.sendMessage(where, { sticker: buffer });
    }
  } catch (e) {
    console.error('[ANTI-DELETE] could not recover:', e.message);
    await sock.sendMessage(where, { text: `${header}\n\n⚠️ Media could not be recovered.`, mentions }).catch(() => {});
  }
}

// ───────────────────────── ONE-TIME SOCKET HOOKS (called from index.js) ─────────────────────────
function init(sock) {
  // 1) store every message + detect deletes + antilink
  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const mek of messages) {
      try {
        if (!mek?.message) continue;
        const raw = unwrap(mek.message);

        // someone deleted a message ("delete for everyone")
        const proto = raw?.protocolMessage;
        if (proto && (proto.type === 0 || proto.type === 'REVOKE') && proto.key?.id) {
          await recover(sock, mek.key.remoteJid, proto.key.id, mek.key.participant || mek.key.remoteJid);
          continue;
        }

        remember({ ...mek, message: raw });

        // anti-link
        const from = mek.key.remoteJid;
        if (!from?.endsWith('@g.us') || mek.key.fromMe) continue;
        if (!gs(from).antilink) continue;
        if (!/chat\.whatsapp\.com\/[A-Za-z0-9]{10,}/i.test(textOf(raw))) continue;

        const meta = await sock.groupMetadata(from).catch(() => null);
        if (!meta) continue;
        const admins = meta.participants.filter((p) => p.admin).map((p) => jidNormalizedUser(p.id));
        const sender = jidNormalizedUser(mek.key.participant);
        const botId = jidNormalizedUser(sock.user.id);
        if (admins.includes(sender) || !admins.includes(botId)) continue; // skip admins / need bot admin

        await sock.sendMessage(from, { delete: mek.key });
        await sock.sendMessage(from, { text: `🚫 @${num(sender)} group links are not allowed. Removed.`, mentions: [sender] });
        await sock.groupParticipantsUpdate(from, [sender], 'remove').catch(() => {});
      } catch (e) { console.error('[group.js upsert]', e.message); }
    }
  });

  // 2) welcome / goodbye
  sock.ev.on('group-participants.update', async (ev) => {
    try {
      if (!gs(ev.id).welcome) return;
      const meta = await sock.groupMetadata(ev.id).catch(() => null);
      for (const p of ev.participants) {
        const jid = typeof p === 'string' ? p : p.id;
        if (ev.action === 'add')
          await sock.sendMessage(ev.id, { text: `👋 Welcome @${num(jid)} to *${meta?.subject || 'the group'}*!`, mentions: [jid] });
        else if (ev.action === 'remove')
          await sock.sendMessage(ev.id, { text: `😢 Goodbye @${num(jid)}.`, mentions: [jid] });
      }
    } catch (e) { console.error('[group.js welcome]', e.message); }
  });
}

// ───────────────────────── COMMANDS ─────────────────────────

// .antidelete on|owner|off
cmd({ pattern: 'antidelete', alias: ['antidel'], desc: 'Recover deleted messages. Eg: .antidelete on | owner | off', category: 'group', react: '🗑️', filename: __filename },
async (sock, mek, m, { q, isOwner, reply }) => {
  if (!isOwner) return reply('❌ Only the bot owner can use this.');
  const a = (q || '').toLowerCase().trim();
  const mode = { on: 'chat', chat: 'chat', owner: 'owner', off: 'off' }[a];
  if (!mode) {
    return reply(
      `🗑️ *Anti-Delete:* ${settings.antidelete === 'off' ? 'OFF ❌' : settings.antidelete === 'chat' ? 'ON (same chat) ✅' : 'ON (owner inbox) ✅'}\n\n` +
      `• *.antidelete on* – repost deleted msgs in the same chat\n• *.antidelete owner* – send them only to your inbox\n• *.antidelete off* – disable`);
  }
  settings.antidelete = mode; save();
  reply(mode === 'off' ? '❌ Anti-Delete disabled.' : mode === 'chat' ? '✅ Anti-Delete ON — deleted messages will be reposted in the same chat.' : '✅ Anti-Delete ON — deleted messages will be sent to the owner inbox.');
});

// .kick  (reply / @mention / number)
cmd({ pattern: 'kick', alias: ['remove'], desc: 'Remove a member. Reply, @mention or give number', category: 'group', react: '🦶', filename: __filename },
async (sock, mek, m, ex) => {
  if (!guard(ex)) return;
  const t = getTargets(mek, ex.q).filter((j) => j !== ex.botNumber2);
  if (!t.length) return ex.reply('❗ Reply to / @mention the member.');
  for (const j of t) await sock.groupParticipantsUpdate(ex.from, [j], 'remove').catch(() => ex.reply(`❌ Could not remove @${num(j)}`));
  sock.sendMessage(ex.from, { text: `✅ Removed ${t.map((j) => '@' + num(j)).join(', ')}`, mentions: t }, { quoted: mek });
});

// .add 94771234567
cmd({ pattern: 'add', desc: 'Add a member. Eg: .add 94771234567', category: 'group', react: '➕', filename: __filename },
async (sock, mek, m, ex) => {
  if (!guard(ex)) return;
  const n = (ex.q || '').replace(/\D/g, '');
  if (n.length < 7) return ex.reply('❗ Usage: .add 94771234567');
  try {
    const res = await sock.groupParticipantsUpdate(ex.from, [toJid(n)], 'add');
    const st = String(res?.[0]?.status || '200');
    ex.reply(st === '200' ? `✅ Added +${n}` : st === '403' ? '⚠️ That user only allows invites. Send them the group link (.link).' : `❌ Could not add (status ${st}).`);
  } catch { ex.reply('❌ Failed to add that number.'); }
});

// .promote / .demote
for (const [pattern, action, icon, word] of [['promote', 'promote', '⬆️', 'promoted to admin'], ['demote', 'demote', '⬇️', 'demoted from admin']]) {
  cmd({ pattern, desc: `${pattern[0].toUpperCase() + pattern.slice(1)} a member. Reply or @mention`, category: 'group', react: icon, filename: __filename },
  async (sock, mek, m, ex) => {
    if (!guard(ex)) return;
    const t = getTargets(mek, ex.q);
    if (!t.length) return ex.reply('❗ Reply to / @mention the member.');
    await sock.groupParticipantsUpdate(ex.from, t, action).catch(() => ex.reply('❌ Failed.'));
    sock.sendMessage(ex.from, { text: `✅ ${t.map((j) => '@' + num(j)).join(', ')} ${word}.`, mentions: t }, { quoted: mek });
  });
}

// .tagall [message]
cmd({ pattern: 'tagall', alias: ['everyone'], desc: 'Mention everyone in the group', category: 'group', react: '📢', filename: __filename },
async (sock, mek, m, ex) => {
  if (!guard(ex, { botAdmin: false })) return;
  const ids = ex.participants.map((p) => p.id);
  const text = `📢 *${ex.q || 'Attention everyone!'}*\n\n` + ids.map((j, i) => `${i + 1}. @${num(j)}`).join('\n');
  sock.sendMessage(ex.from, { text, mentions: ids }, { quoted: mek });
});

// .hidetag <message>  (silent mention)
cmd({ pattern: 'hidetag', alias: ['htag'], desc: 'Mention everyone without showing the list', category: 'group', react: '👻', filename: __filename },
async (sock, mek, m, ex) => {
  if (!guard(ex, { botAdmin: false })) return;
  if (!ex.q) return ex.reply('❗ Usage: .hidetag your message');
  sock.sendMessage(ex.from, { text: ex.q, mentions: ex.participants.map((p) => p.id) });
});

// .mute / .unmute
cmd({ pattern: 'mute', alias: ['close'], desc: 'Only admins can send messages', category: 'group', react: '🔇', filename: __filename },
async (sock, mek, m, ex) => {
  if (!guard(ex)) return;
  await sock.groupSettingUpdate(ex.from, 'announcement').catch(() => ex.reply('❌ Failed.'));
  ex.reply('🔇 Group muted — only admins can send messages.');
});
cmd({ pattern: 'unmute', alias: ['open'], desc: 'Everyone can send messages', category: 'group', react: '🔊', filename: __filename },
async (sock, mek, m, ex) => {
  if (!guard(ex)) return;
  await sock.groupSettingUpdate(ex.from, 'not_announcement').catch(() => ex.reply('❌ Failed.'));
  ex.reply('🔊 Group unmuted — everyone can send messages.');
});

// .link / .revoke
cmd({ pattern: 'link', alias: ['grouplink'], desc: 'Get the group invite link', category: 'group', react: '🔗', filename: __filename },
async (sock, mek, m, ex) => {
  if (!guard(ex)) return;
  const code = await sock.groupInviteCode(ex.from).catch(() => null);
  ex.reply(code ? `🔗 https://chat.whatsapp.com/${code}` : '❌ Could not get the link.');
});
cmd({ pattern: 'revoke', alias: ['resetlink'], desc: 'Reset the group invite link', category: 'group', react: '♻️', filename: __filename },
async (sock, mek, m, ex) => {
  if (!guard(ex)) return;
  await sock.groupRevokeInvite(ex.from).catch(() => ex.reply('❌ Failed.'));
  ex.reply('♻️ Invite link has been reset. Use .link to get the new one.');
});

// .setname / .setdesc
cmd({ pattern: 'setname', desc: 'Change group name', category: 'group', react: '✏️', filename: __filename },
async (sock, mek, m, ex) => {
  if (!guard(ex)) return;
  if (!ex.q) return ex.reply('❗ Usage: .setname New Name');
  await sock.groupUpdateSubject(ex.from, ex.q).catch(() => ex.reply('❌ Failed.'));
});
cmd({ pattern: 'setdesc', desc: 'Change group description', category: 'group', react: '📝', filename: __filename },
async (sock, mek, m, ex) => {
  if (!guard(ex)) return;
  if (!ex.q) return ex.reply('❗ Usage: .setdesc New description');
  await sock.groupUpdateDescription(ex.from, ex.q).catch(() => ex.reply('❌ Failed.'));
});

// .antilink on|off
cmd({ pattern: 'antilink', desc: 'Delete WhatsApp group links & remove sender. Eg: .antilink on', category: 'group', react: '🚫', filename: __filename },
async (sock, mek, m, ex) => {
  if (!guard(ex)) return;
  const a = (ex.q || '').toLowerCase().trim();
  if (!['on', 'off'].includes(a)) return ex.reply(`🚫 *Anti-Link:* ${gs(ex.from).antilink ? 'ON ✅' : 'OFF ❌'}\nUsage: .antilink on | off`);
  gs(ex.from).antilink = a === 'on'; save();
  ex.reply(a === 'on' ? '✅ Anti-Link enabled.' : '❌ Anti-Link disabled.');
});

// .welcome on|off
cmd({ pattern: 'welcome', desc: 'Welcome / goodbye messages. Eg: .welcome on', category: 'group', react: '👋', filename: __filename },
async (sock, mek, m, ex) => {
  if (!guard(ex, { botAdmin: false })) return;
  const a = (ex.q || '').toLowerCase().trim();
  if (!['on', 'off'].includes(a)) return ex.reply(`👋 *Welcome msg:* ${gs(ex.from).welcome ? 'ON ✅' : 'OFF ❌'}\nUsage: .welcome on | off`);
  gs(ex.from).welcome = a === 'on'; save();
  ex.reply(a === 'on' ? '✅ Welcome/Goodbye messages enabled.' : '❌ Welcome/Goodbye messages disabled.');
});

// .groupinfo
cmd({ pattern: 'groupinfo', alias: ['ginfo'], desc: 'Show group information', category: 'group', react: 'ℹ️', filename: __filename },
async (sock, mek, m, ex) => {
  if (!guard(ex, { admin: false, botAdmin: false })) return;
  const md = ex.groupMetadata;
  const admins = ex.groupAdmins.map((j) => '@' + num(j));
  const s = gs(ex.from);
  sock.sendMessage(ex.from, {
    text:
      `ℹ️ *${md.subject}*\n\n👥 Members: ${ex.participants.length}\n👑 Admins: ${admins.length}\n` +
      `📅 Created: ${md.creation ? new Date(md.creation * 1000).toLocaleDateString('en-GB') : 'N/A'}\n` +
      `🚫 Anti-Link: ${s.antilink ? 'ON' : 'OFF'}\n👋 Welcome: ${s.welcome ? 'ON' : 'OFF'}\n\n` +
      `${md.desc ? `📝 ${md.desc}\n\n` : ''}*Admins:*\n${admins.join('\n')}`,
    mentions: ex.groupAdmins,
  }, { quoted: mek });
});

// .admins  (tag admins)
cmd({ pattern: 'admins', desc: 'Tag all group admins', category: 'group', react: '👑', filename: __filename },
async (sock, mek, m, ex) => {
  if (!guard(ex, { admin: false, botAdmin: false })) return;
  sock.sendMessage(ex.from, { text: `👑 *Admins*\n\n${ex.groupAdmins.map((j) => '@' + num(j)).join('\n')}`, mentions: ex.groupAdmins }, { quoted: mek });
});

module.exports = { init };

/*
 ───────────── index.js ekata mekak witharai add karanna ─────────────
 `const danuwa = makeWASocket({ ... });`  kiyana line eka ehema awasan wena තැනට පසුව:

     require('./plugins/group').init(danuwa);
*/
