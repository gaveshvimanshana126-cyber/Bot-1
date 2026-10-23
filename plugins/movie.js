const { cmd } = require('../command');
const axios = require('axios');

// TODO (after testing): delete the hardcoded fallback key below and use ONLY the CINE_API_KEY env var / GitHub secret.
// A key written in the code is visible to everyone if the repo is public.
const API_BASE = 'https://api.chamindu.site';
const API_KEY = process.env.CINE_API_KEY || 'chama_api_9d3e78236d1d8e63def0761c1831b855';
const DEFAULT_IMAGE = 'https://api.chamindu.site/logo.png';
const FOOTER = `\n\n> 🎭 𝗖𝗛𝗔𝗠𝗔 𝗖𝗜𝗡𝗘 𝗛𝗨𝗕 🎭\n> 🧬 ᴘᴏᴡᴇʀᴇᴅ ʙʏ 🇨🇭𝗔𝗠𝗔 𝗧𝗘𝗖𝗛`;
const REPLY_TIMEOUT = 5 * 60 * 1000; // stop waiting for a reply after 5 minutes
const HTTP_TIMEOUT = 20000;

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
      await socket.sendMessage(chat, { text: `⚠️ *Invalid choice! Range: 01 - ${pad(max)}*` }, { quoted: mek });
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
      text: `*❪ ERROR ❫*\n\n⚠️ *Invalid Usage!*\n\n🎬 *Example:*\n• .cinesubz avatar\n• .cinesubz game of thrones\n\n📝 _Please provide the Movie or Series name!_${FOOTER}`,
    });
  }

  const query = args.join(' ').trim();
  await send({ text: `*❪ SEARCHING ❫*\n\n🔍 *Searching CineSubz (CineTV) for:* _${query}_\n⚡ _Please wait a moment..._` });

  try {
    const res = await axios.get(`${API_BASE}/api/v1/movie/cinesubz/search`, {
      params: { q: query, api_key: API_KEY },
      timeout: HTTP_TIMEOUT,
    });
    const results = res.data?.data || res.data?.results || [];

    if (!results.length) {
      return send({ text: `*❪ NO RESULTS ❫*\n\n😞 *No Results Found on CineSubz (CineTV)!*\n🎬 *Query:* _${query}_${FOOTER}` });
    }

    const shown = results.slice(0, 15); // only these are selectable (before: you could pick hidden items)
    let listText = `*❪ CINESUBZ (CINETV) SEARCH RESULTS ❫*\n\n🎯 *Query:* _${query}_\n📊 *Total:* _${results.length} Items_\n\n*👇 SELECT A NUMBER 👇*\n\n`;
    shown.forEach((item, i) => {
      const icon = isTv(item) ? '📺' : '🎥';
      listText += `*${pad(i + 1)}* ➜ ${icon} _${(item.title || 'Movie').substring(0, 32)}_ (${item.year || 'N/A'})\n`;
    });
    listText += `\n📌 _Reply with the number to download!_${FOOTER}`;

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
          await reply({ text: `*❪ FETCHING ❫*\n\n📺 *Fetching TV Series details from CINESUBZ (CINETV)...*\n⚡ _Please wait..._` });
          try {
            const tvInfo = await getInfo(selected);
            const episodes = tvInfo.episodes || tvInfo.downloads || [];

            await reply({
              image: { url: tvInfo.image || selected.image || DEFAULT_IMAGE },
              caption: `*❪ TV SERIES DETAILS ❫*\n\n📺 *${tvInfo.title || selected.title}*\n⭐ *Rating:* ★ ${tvInfo.rating || tvInfo.imdb || 'N/A'}\n📅 *Year:* ${tvInfo.year || 'N/A'}\n🎬 *Episodes:* ${episodes.length}\n${FOOTER}`,
            });

            if (episodes.length > 0) {
              let epText = `*❪ EPISODE DOWNLOADS ❫*\n\n📺 *Series:* _${tvInfo.title || selected.title}_\n\n`;
              episodes.slice(0, 15).forEach((ep, i) => {
                epText += `*Episode ${i + 1}:* ${ep.name || ep.title || 'Episode ' + (i + 1)}\n🔗 ${ep.download_link || ep.link || ep.url}\n\n`;
              });
              await reply({ text: epText + FOOTER });
            }
          } catch (e) {
            await reply({ text: `❌ *TV Show Error:* ${e.message}${FOOTER}` });
          }
          return;
        }

        // ---------------- MOVIE ----------------
        await reply({ text: `*❪ FETCHING ❫*\n\n🎬 *Fetching Movie details from CineSubz (CineTV)...*\n⚡ _Please wait..._` });
        try {
          const movie = await getInfo(selected);
          const downloads = movie.downloads || [];
          const title = movie.title || selected.title;
          const story = movie.story ? (movie.story.length > 220 ? movie.story.substring(0, 220) + '...' : movie.story) : 'N/A';

          await reply({
            image: { url: movie.image || selected.image || DEFAULT_IMAGE },
            caption: `*❪ MOVIE DETAILS ❫*\n\n🎬 *${title}*\n⭐ 𝗜𝗠𝗗𝗕 ➜ ★ ${movie.imdb || movie.rating || 'N/A'}\n📅 𝗬𝗲𝗮𝗿 ➜ ${movie.year || 'N/A'}\n⏳ 𝗗𝘂𝗿𝗮𝘁𝗶𝗼𝗻 ➜ ${movie.duration || 'N/A'}\n🌍 𝗖𝗼𝘂𝗻𝘁𝗿𝘆 ➜ ${movie.country || 'N/A'}\n🎭 𝗚𝗲𝗻𝗿𝗲𝘀 ➜ ${Array.isArray(movie.genres) ? movie.genres.join(', ') : (movie.genres || 'N/A')}\n📝 𝗦𝘁𝗼𝗿𝘆 ➜ ${story}\n${FOOTER}`,
          });

          if (downloads.length === 0) {
            return reply({ text: `⚠️ *No Direct Downloads available for this movie right now.*${FOOTER}` });
          }

          const qualityText =
            `*❪ DOWNLOAD QUALITIES ❫*\n\n📥 *Select Quality:*\n\n` +
            downloads.map((dl, i) => `*${pad(i + 1)}* ➜ 💾 _${dl.quality || 'Direct MP4'}_ (${dl.size || 'Direct'})`).join('\n') +
            `\n\n📌 _Reply with the number to send file!_${FOOTER}`;
          const dlMsg = await reply({ text: qualityText });

          waitForChoice(socket, {
            chat: sender,
            messageId: dlMsg.key.id,
            max: downloads.length,
            onChoice: async (dlChoice, dlReplyMek) => {
              const dl = downloads[dlChoice];
              const dlReply = (content) => send(content, dlReplyMek);
              const fileUrl = dl.link || dl.download_link || dl.direct_link;

              if (!fileUrl) return dlReply({ text: '❌ *No download link for this quality.*' });

              await dlReply({ text: `*❪ SENDING MOVIE ❫*\n\n📥 *Sending:* _${title}_\n📊 *Quality:* _${dl.quality || 'HD'}_\n⚡ _Uploading file to WhatsApp..._` });
              try {
                await dlReply({
                  document: { url: fileUrl },
                  mimetype: 'video/mp4',
                  fileName: `${title} (${dl.quality || 'HD'}).mp4`,
                  caption: `*🎬 𝗖𝗛𝗔𝗠𝗔 𝗖𝗜𝗡𝗘 𝗠𝗢𝗩𝗜𝗘 🎬*\n\n🎭 *Title:* ${title}\n📊 *Quality:* ${dl.quality || 'HD'}\n💾 *Size:* ${dl.size || 'Direct'}${FOOTER}`,
                });
              } catch (sendErr) {
                await dlReply({ text: `⚠️ *Direct upload error:* ${sendErr.message}\n\n🔗 *Direct Link:* ${fileUrl}${FOOTER}` });
              }
            },
          });
        } catch (e) {
          await reply({ text: `❌ *Details Error:* ${e.message}${FOOTER}` });
        }
      },
    });
  } catch (err) {
    await send({ text: `*❪ ERROR ❫*\n\n❌ *Search Error:* ${err.message}${FOOTER}` });
  }
});
