const { cmd } = require('../command');
const axios = require('axios');

// TODO (after testing): delete the hardcoded fallback key below and use ONLY the CINE_API_KEY env var / GitHub secret.
// A key written in the code is visible to everyone if the repo is public.
const API_BASE = 'https://api.chamindu.site';
const API_KEY = process.env.CINE_API_KEY || 'chama_api_9d3e78236d1d8e63def0761c1831b855';
const DEFAULT_IMAGE = 'https://api.chamindu.site/logo.png';

// ---------- BRANDING (change these two and everything updates) ----------
const BOT_NAME = 'MOVIEMANIA LK';
const POWERED_BY = 'Luzzy MD';

const LINE = '━━━━━━━━━━━━━━━━━━━━';
const FOOTER = `\n\n${LINE}\n*🎬 ${BOT_NAME}*\n> ⚡ Powered by ${POWERED_BY}`;

const REPLY_TIMEOUT = 5 * 60 * 1000; // stop waiting for a reply after 5 minutes
const HTTP_TIMEOUT = 20000;

// ---------- design helpers ----------
// A value counts as "empty" if missing / N/A -> that row is simply hidden (no ugly "N/A" lines)
const clean = (v) => {
  if (v === undefined || v === null) return null;
  const t = String(Array.isArray(v) ? v.join(', ') : v).trim();
  return !t || /^(n\/a|null|undefined|-)$/i.test(t) ? null : t;
};
const row = (icon, label, value) => (clean(value) ? `│ ${icon} *${label}:* ${clean(value)}` : null);
const trimText = (t, max = 260) => {
  t = clean(t);
  if (!t) return null;
  if (t.length <= max) return t;
  return t.slice(0, max).replace(/\s+\S*$/, '') + '...';
};

// left-border card (never misaligns, whatever font the phone uses)
const card = (icon, title, rows = [], tail = '') => {
  const body = rows.filter(Boolean).join('\n');
  return `╭─「 ${icon} *${title}* 」\n│${body ? '\n' + body + '\n│' : ''}\n╰──────────────────${tail ? '\n\n' + tail : ''}`;
};

const pad = (n) => String(n).padStart(2, '0');
const textOf = (mek) => mek.message?.conversation || mek.message?.extendedTextMessage?.text || '';
const isTv = (item) => item.type === 'tvshows' || item.type === 'tv';
const itemUrl = (item) => item.link || item.url;

// Wait for ONE valid "number" reply to a specific message, then call onChoice.
// The listener is always removed (on valid choice or after timeout) -> no listener leak.
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

    cleanup();            // remove first, so a double reply can't trigger it twice
    await onChoice(choice, mek);
  };
  const timer = setTimeout(() => cleanup(), REPLY_TIMEOUT);
  const cleanup = () => {
    clearTimeout(timer);
    socket.ev.off('messages.upsert', handler);
  };
  socket.ev.on('messages.upsert', handler);
}

const getInfo = async (item) => {
  const res = await axios.get(`${API_BASE}/api/v1/movie/cinesubz/infodl`, {
    params: { q: itemUrl(item), api_key: API_KEY },
    timeout: HTTP_TIMEOUT,
  });
  return res.data?.data || {};
};

cmd({
  pattern: 'cinesubz',
  alias: ['cs'],
  desc: 'Sinhala subtitles movies, TV series and direct downloads',
  category: 'download',
  react: '🎥',
  filename: __filename,
},
async (socket, msg, m, { from, args }) => {
  const sender = from;
  const send = (content, quoted = msg) => socket.sendMessage(sender, content, { quoted });

  if (!API_KEY) {
    return send({ text: '❌ *CINE_API_KEY is not set.* Add it as an environment variable / GitHub secret.' });
  }

  if (!args.length) {
    return send({
      text: card('⚠️', 'INVALID USAGE', [
        '│ 🎬 *Examples:*',
        '│ • .cs avatar',
        '│ • .cs game of thrones',
        '│',
        '│ 📝 _Please type a movie or series name._',
      ]) + FOOTER,
    });
  }

  const query = args.join(' ').trim();
  await send({ text: card('🔍', 'SEARCHING', [row('🎯', 'Query', query), '│ ⚡ _Please wait a moment..._']) });

  try {
    const res = await axios.get(`${API_BASE}/api/v1/movie/cinesubz/search`, {
      params: { q: query, api_key: API_KEY },
      timeout: HTTP_TIMEOUT,
    });
    const results = res.data?.data || res.data?.results || [];

    if (!results.length) {
      return send({
        text: card('😞', 'NO RESULTS', [row('🎯', 'Query', query), '│ _Nothing found. Check the spelling or try another name._']) + FOOTER,
      });
    }

    const shown = results.slice(0, 15); // only these are selectable
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
    const listText = card('🔎', 'SEARCH RESULTS', listRows, '👇 _Reply to this message with a number_') + FOOTER;

    const sentMsg = await send({ text: listText });

    waitForChoice(socket, {
      chat: sender,
      messageId: sentMsg.key.id,
      max: shown.length,
      onChoice: async (choice, replyMek) => {
        const selected = shown[choice];
        const reply = (content) => send(content, replyMek);

        // ---------------- TV SERIES ----------------
        if (isTv(selected)) {
          await reply({ text: card('📺', 'FETCHING', ['│ ⚡ _Getting series details..._']) });
          try {
            const tvInfo = await getInfo(selected);
            const episodes = tvInfo.episodes || tvInfo.downloads || [];
            const tvTitle = tvInfo.title || selected.title;

            await reply({
              image: { url: tvInfo.image || selected.image || DEFAULT_IMAGE },
              caption: card('📺', 'TV SERIES', [
                row('🎞️', 'Title', tvTitle),
                row('⭐', 'Rating', tvInfo.rating || tvInfo.imdb),
                row('📅', 'Year', tvInfo.year),
                row('🎬', 'Episodes', episodes.length || null),
              ]) + FOOTER,
            });

            if (episodes.length > 0) {
              const epRows = [row('📺', 'Series', tvTitle), '│'];
              episodes.slice(0, 15).forEach((ep, i) => {
                epRows.push(`│ *${pad(i + 1)}* ❯ ${ep.name || ep.title || 'Episode ' + (i + 1)}`);
                epRows.push(`│ 🔗 ${ep.download_link || ep.link || ep.url}`);
                epRows.push('│');
              });
              epRows.pop(); // remove the last spacer
              await reply({ text: card('📥', 'EPISODE DOWNLOADS', epRows) + FOOTER });
            }
          } catch (e) {
            await reply({ text: card('❌', 'TV SHOW ERROR', [`│ ${e.message}`]) + FOOTER });
          }
          return;
        }

        // ---------------- MOVIE ----------------
        await reply({ text: card('🎬', 'FETCHING', ['│ ⚡ _Getting movie details..._']) });
        try {
          const movie = await getInfo(selected);
          const downloads = movie.downloads || [];
          const title = movie.title || selected.title;
          const story = trimText(movie.story);

          await reply({
            image: { url: movie.image || selected.image || DEFAULT_IMAGE },
            caption: card('🎬', 'MOVIE DETAILS', [
              row('🎞️', 'Title', title),
              row('⭐', 'IMDb', movie.imdb || movie.rating),
              row('📅', 'Year', movie.year),
              row('⏳', 'Duration', movie.duration),
              row('🌍', 'Country', movie.country),
              row('🎭', 'Genres', movie.genres),
            ], story ? `📝 *Story*\n_${story}_` : '') + FOOTER,
          });

          if (downloads.length === 0) {
            return reply({ text: card('⚠️', 'NO DOWNLOADS', ['│ _No direct downloads available right now._']) + FOOTER });
          }

          const qRows = downloads.map((dl, i) => {
            const size = clean(dl.size) ? ` • ${clean(dl.size)}` : '';
            return `│ *${pad(i + 1)}* ❯ 💾 ${dl.quality || 'Direct MP4'}${size}`;
          });
          const qualityText = card('📥', 'DOWNLOAD QUALITIES', qRows, '👇 _Reply with a number to get the file_') + FOOTER;
          const dlMsg = await reply({ text: qualityText });

          waitForChoice(socket, {
            chat: sender,
            messageId: dlMsg.key.id,
            max: downloads.length,
            onChoice: async (dlChoice, dlReplyMek) => {
              const dl = downloads[dlChoice];
              const dlReply = (content) => send(content, dlReplyMek);
              const fileUrl = dl.link || dl.download_link || dl.direct_link;

              if (!fileUrl) return dlReply({ text: card('❌', 'NO LINK', ['│ _No download link for this quality._']) + FOOTER });

              await dlReply({
                text: card('📤', 'SENDING', [
                  row('🎞️', 'Title', title),
                  row('📊', 'Quality', dl.quality || 'HD'),
                  '│ ⚡ _Uploading to WhatsApp, please wait..._',
                ]),
              });
              try {
                await dlReply({
                  document: { url: fileUrl },
                  mimetype: 'video/mp4',
                  fileName: `${title} (${dl.quality || 'HD'}).mp4`,
                  caption: card('🎬', BOT_NAME, [
                    row('🎞️', 'Title', title),
                    row('📊', 'Quality', dl.quality || 'HD'),
                    row('💾', 'Size', dl.size),
                  ]) + FOOTER,
                });
              } catch (sendErr) {
                await dlReply({
                  text: card('⚠️', 'UPLOAD FAILED', [`│ ${sendErr.message}`, '│', `│ 🔗 *Direct link:* ${fileUrl}`]) + FOOTER,
                });
              }
            },
          });
        } catch (e) {
          await reply({ text: card('❌', 'DETAILS ERROR', [`│ ${e.message}`]) + FOOTER });
        }
      },
    });
  } catch (err) {
    await send({ text: card('❌', 'SEARCH ERROR', [`│ ${err.message}`]) + FOOTER });
  }
});
