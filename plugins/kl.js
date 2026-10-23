// plugins/moviebox.js  —  MovieBox search + download (LUZZ-MD)
const { cmd } = require('../command');
const axios = require('axios');
const config = require('../config');

// Put the key in env MOVIEBOX_API_KEY (or CINE_API_KEY). The fallback is only for testing.
const API_BASE = 'https://api.chamindu.site';
const API_KEY =
  process.env.MOVIEBOX_API_KEY ||
  process.env.CINE_API_KEY ||
  'chama_api_9d3e78236d1d8e63def0761c1831b855';
const DEFAULT_IMAGE = 'https://api.chamindu.site/logo.png';

// ---------- branding (comes from config.js: BOT_NAME / CREATOR) ----------
const LINE = '━━━━━━━━━━━━━━━━━━━━';
const FOOTER = `\n\n${LINE}\n*🎬 ${config.BOT_NAME}*\n> ⚡ Created by ${config.CREATOR}`;

const REPLY_TIMEOUT = 5 * 60 * 1000; // stop waiting for a reply after 5 minutes
const HTTP_TIMEOUT = 20000;

// ---------- design helpers ----------
const clean = (v) => {
  if (v === undefined || v === null) return null;
  const t = String(Array.isArray(v) ? v.join(', ') : v).trim();
  return !t || /^(n\/a|null|undefined|-)$/i.test(t) ? null : t;
};
const row = (icon, label, value) => (clean(value) ? `│ ${icon} *${label}:* ${clean(value)}` : null);
const trimText = (t, max = 260) => {
  t = clean(t);
  if (!t) return null;
  return t.length <= max ? t : t.slice(0, max).replace(/\s+\S*$/, '') + '...';
};
const card = (icon, title, rows = [], tail = '') => {
  const body = rows.filter(Boolean).join('\n');
  return `╭─「 ${icon} *${title}* 」\n│${body ? '\n' + body + '\n│' : ''}\n╰──────────────────${tail ? '\n\n' + tail : ''}`;
};

const pad = (n) => String(n).padStart(2, '0');
const textOf = (mek) => mek.message?.conversation || mek.message?.extendedTextMessage?.text || '';
const isTv = (item) => item.type === 'tvshows' || item.type === 'tv';
const itemUrl = (item) => item.link || item.url;

// Wait for ONE valid "number" reply to a specific message. Listener is always removed.
function waitForChoice(socket, { chat, messageId, max, onChoice }) {
  const handler = async ({ messages, type }) => {
    if (type && type !== 'notify') return;
    const mek = messages?.[0];
    if (!mek?.message) return;
    if (mek.message.extendedTextMessage?.contextInfo?.stanzaId !== messageId) return;
    if (mek.key.remoteJid !== chat) return;

    const choice = parseInt(textOf(mek), 10) - 1;
    if (isNaN(choice) || choice < 0 || choice >= max) {
      await socket.sendMessage(chat, { text: `⚠️ *Invalid choice!* Pick a number from 01 to ${pad(max)}.` }, { quoted: mek });
      return; // keep listening
    }
    cleanup();
    try { await onChoice(choice, mek); } catch (e) { console.error('[moviebox]', e.message); }
  };
  const timer = setTimeout(() => cleanup(), REPLY_TIMEOUT);
  const cleanup = () => { clearTimeout(timer); socket.ev.off('messages.upsert', handler); };
  socket.ev.on('messages.upsert', handler);
}

const getInfo = async (item) => {
  const res = await axios.get(`${API_BASE}/api/v1/movie/moviebox/info`, {
    params: { q: itemUrl(item), api_key: API_KEY },
    timeout: HTTP_TIMEOUT,
  });
  return res.data?.data || {};
};

cmd({
  pattern: 'moviebox',
  alias: ['mb'],
  desc: 'MovieBox movies & series: streaming and direct downloads',
  category: 'download',
  react: '🎥',
  filename: __filename,
},
async (socket, msg, m, { from, args }) => {
  const send = (content, quoted = msg) => socket.sendMessage(from, content, { quoted });

  if (!args.length) {
    return send({
      text: card('⚠️', 'INVALID USAGE', [
        '│ 🎬 *Examples:*',
        '│ • .moviebox avatar',
        '│ • .mb game of thrones',
        '│',
        '│ 📝 _Please type a movie or series name._',
      ]) + FOOTER,
    });
  }

  const query = args.join(' ').trim();
  await send({ text: card('🔍', 'SEARCHING', [row('🎯', 'Query', query), '│ ⚡ _Please wait a moment..._']) });

  try {
    const res = await axios.get(`${API_BASE}/api/v1/movie/moviebox/search`, {
      params: { q: query, api_key: API_KEY },
      timeout: HTTP_TIMEOUT,
    });
    const results = res.data?.data || res.data?.results || [];

    if (!results.length) {
      return send({
        text: card('😞', 'NO RESULTS', [row('🎯', 'Query', query), '│ _Nothing found. Check the spelling or try another name._']) + FOOTER,
      });
    }

    const shown = results.slice(0, 15);
    const listRows = [
      row('🎯', 'Query', query),
      row('📊', 'Found', `${results.length} title${results.length > 1 ? 's' : ''}`),
      '│',
    ];
    shown.forEach((item, i) => {
      const icon = isTv(item) ? '📺' : '🎥';
      const year = clean(item.year) ? ` _(${clean(item.year)})_` : '';
      listRows.push(`│ *${pad(i + 1)}* ❯ ${icon} ${(item.title || 'Movie').substring(0, 32)}${year}`);
    });
    const sentMsg = await send({ text: card('🔎', 'MOVIEBOX RESULTS', listRows, '👇 _Reply to this message with a number_') + FOOTER });

    waitForChoice(socket, {
      chat: from,
      messageId: sentMsg.key.id,
      max: shown.length,
      onChoice: async (choice, replyMek) => {
        const item = shown[choice];
        const reply = (content) => send(content, replyMek);

        await reply({ text: card('⏳', 'FETCHING', [row(isTv(item) ? '📺' : '🎬', 'Title', item.title), '│ ⚡ _Please wait..._']) });

        let info;
        try { info = await getInfo(item); }
        catch (e) { return reply({ text: card('❌', 'DETAILS ERROR', [`│ ${e.message}`]) + FOOTER }); }

        const title = clean(info.title) || clean(item.title) || 'Unknown';
        const poster = info.image || item.image || DEFAULT_IMAGE;

        // ===================== TV SERIES =====================
        if (isTv(item)) {
          const episodes = info.episodes || info.downloads || [];
          await reply({
            image: { url: poster },
            caption: card('📺', 'TV SERIES', [
              row('📺', 'Title', title),
              row('⭐', 'Rating', info.rating || info.imdb),
              row('📅', 'Year', info.year),
              row('🎬', 'Episodes', episodes.length || null),
            ]) + FOOTER,
          });

          if (episodes.length) {
            const epRows = [row('📺', 'Series', title), '│'];
            episodes.slice(0, 15).forEach((ep, i) => {
              epRows.push(`│ *${pad(i + 1)}* ❯ ${ep.name || ep.title || 'Episode ' + (i + 1)}`);
              epRows.push(`│ 🔗 ${ep.download_link || ep.link || ep.url}`);
              epRows.push('│');
            });
            await reply({ text: card('📥', 'EPISODE DOWNLOADS', epRows) + FOOTER });
          } else {
            await reply({ text: card('⚠️', 'NO EPISODES', ['│ _No episode links available right now._']) + FOOTER });
          }
          return;
        }

        // ===================== MOVIE =====================
        const downloads = info.downloads || [];
        const story = trimText(info.story);

        await reply({
          image: { url: poster },
          caption: card('🎬', 'MOVIE DETAILS', [
            row('🎬', 'Title', title),
            row('⭐', 'IMDb', info.imdb || info.rating),
            row('📅', 'Year', info.year),
            row('⏳', 'Duration', info.duration),
            row('🌍', 'Country', info.country),
            row('🎭', 'Genres', info.genres),
            story ? `│\n│ 📝 _${story}_` : null,
          ]) + FOOTER,
        });

        if (!downloads.length) {
          return reply({ text: card('⚠️', 'NO DOWNLOADS', ['│ _No direct downloads available for this movie right now._']) + FOOTER });
        }

        const qRows = [row('🎬', 'Movie', title), '│'];
        downloads.forEach((dl, i) => {
          const size = clean(dl.size) ? ` _(${clean(dl.size)})_` : '';
          qRows.push(`│ *${pad(i + 1)}* ❯ 💾 ${dl.quality || 'Direct MP4'}${size}`);
        });
        const dlMsg = await reply({ text: card('📥', 'DOWNLOAD QUALITIES', qRows, '👇 _Reply with a number to get the file_') + FOOTER });

        waitForChoice(socket, {
          chat: from,
          messageId: dlMsg.key.id,
          max: downloads.length,
          onChoice: async (dlChoice, dlReplyMek) => {
            const dl = downloads[dlChoice];
            const fileUrl = dl.link || dl.download_link || dl.direct_link;
            const quality = dl.quality || 'HD';

            await send({
              text: card('📤', 'SENDING MOVIE', [
                row('🎬', 'Title', title),
                row('📊', 'Quality', quality),
                '│ ⚡ _Uploading file to WhatsApp..._',
              ]),
            }, dlReplyMek);

            try {
              await send({
                document: { url: fileUrl },
                mimetype: 'video/mp4',
                fileName: `${title} (${quality}).mp4`,
                caption: card('🎬', `${config.BOT_NAME} MOVIE`, [
                  row('🎭', 'Title', title),
                  row('📊', 'Quality', quality),
                  row('💾', 'Size', dl.size),
                ]) + FOOTER,
              }, dlReplyMek);
            } catch (e) {
              await send({
                text: card('⚠️', 'UPLOAD ERROR', [`│ ${e.message}`, '│', `│ 🔗 *Direct link:*`, `│ ${fileUrl}`]) + FOOTER,
              }, dlReplyMek);
            }
          },
        });
      },
    });
  } catch (err) {
    send({ text: card('❌', 'SEARCH ERROR', [`│ ${err.message}`]) + FOOTER });
  }
});
