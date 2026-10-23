import { cmd } from '../command.js';
import axios from 'axios';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);

const API_BASE = 'https://api.chamindu.site';
const API_KEY = 'chama_api_9d3e78236d1d8e63def0761c1831b855';
const DEFAULT_IMAGE = `${API_BASE}/logo.png`;

const BRAND = '🤍 𝗟𝗨𝗭𝗭𝗬 𝗠𝗗';
const CREATOR = 'Created by Gavesh Vimanshana';

const FOOTER = `\n\n━━━━━━━━━━━━━━━━━━\n${BRAND}\n${CREATOR}`;

const formatError = (error) => {
    if (error.response) {
        return `API Error: ${error.response.status}`;
    }

    return error.message || 'Unknown error';
};

const getText = (message) => {
    const content = message?.message;

    return (
        content?.conversation ||
        content?.extendedTextMessage?.text ||
        ''
    ).trim();
};

const getReplyId = (message) =>
    message?.message?.extendedTextMessage?.contextInfo?.stanzaId;

const isValidNumber = (text) => /^\d+$/.test(text);

const safeFilename = (name) =>
    name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 150);

const sendText = (socket, jid, text, quoted) =>
    socket.sendMessage(jid, { text }, { quoted });

cmd({
    pattern: 'sinhalacartoons',
    alias: ['sc'],
    desc: 'Search Sinhala dubbed cartoons and animated movies',
    category: 'download',
    react: '🎬',
    filename: __filename
}, async (socket, msg, m, { from, args }) => {
    const sender = from;

    if (!args?.length) {
        await sendText(
            socket,
            sender,
            `╭━━━〔 ${BRAND} 〕━━━╮\n\n` +
            `⚠️ *Movie name එකක් ඇතුළත් කරන්න!*\n\n` +
            `📌 *Examples:*\n` +
            `• .sinhalacartoons avatar\n` +
            `• .sc frozen\n` +
            `• .sc kung fu panda\n\n` +
            `🔎 Sinhala dubbed movies සහ cartoons සොයන්න.` +
            FOOTER,
            msg
        );

        return;
    }

    const query = args.join(' ').trim();

    await sendText(
        socket,
        sender,
        `╭━━━〔 🔍 SEARCHING 〕━━━╮\n\n` +
        `🎬 *Search:* ${query}\n` +
        `⏳ _Please wait..._` +
        FOOTER,
        msg
    );

    try {
        const response = await axios.get(
            `${API_BASE}/api/v1/cartoons/sinhalacartoons/search`,
            {
                params: {
                    q: query,
                    api_key: API_KEY
                },
                timeout: 30000
            }
        );

        const results =
            response.data?.data ||
            response.data?.results ||
            [];

        if (!Array.isArray(results) || !results.length) {
            await sendText(
                socket,
                sender,
                `╭━━━〔 NO RESULTS 〕━━━╮\n\n` +
                `😔 Search results හමු වුණේ නැහැ.\n` +
                `🔎 *Search:* ${query}` +
                FOOTER,
                msg
            );

            return;
        }

        const items = results.slice(0, 15);

        let text =
            `╭━━━〔 🤍 LUZZY MD 〕━━━╮\n\n` +
            `🔍 *Search:* ${query}\n` +
            `📂 *Results:* ${items.length}\n\n` +
            `━━━━━━━━━━━━━━━━━━\n`;

        items.forEach((item, index) => {
            const number = String(index + 1).padStart(2, '0');
            const isTV =
                item.type === 'tvshows' ||
                item.type === 'tv';

            text +=
                `\n*${number}.* ${isTV ? '📺' : '🎬'} ` +
                `${item.title || 'Unknown Title'}\n` +
                `   📅 ${item.year || 'N/A'}\n`;
        });

        text +=
            `\n━━━━━━━━━━━━━━━━━━\n` +
            `📌 *Reply to this message with a number.*` +
            FOOTER;

        const searchMessage = await socket.sendMessage(
            sender,
            { text },
            { quoted: msg }
        );

        const searchMessageId = searchMessage.key.id;

        let selectionBusy = false;

        const handleSearchSelection = async ({ messages }) => {
            const reply = messages?.[0];

            if (!reply?.message || reply.key?.fromMe) return;
            if (reply.key?.remoteJid !== sender) return;
            if (getReplyId(reply) !== searchMessageId) return;
            if (selectionBusy) return;

            const choiceText = getText(reply);

            if (!isValidNumber(choiceText)) return;

            const index = Number(choiceText) - 1;

            if (index < 0 || index >= items.length) {
                await sendText(
                    socket,
                    sender,
                    `⚠️ *Invalid selection!*\n` +
                    `Choose a number from 1 to ${items.length}.`,
                    reply
                );

                return;
            }

            selectionBusy = true;
            socket.ev.off('messages.upsert', handleSearchSelection);

            try {
                const selected = items[index];
                const isTV =
                    selected.type === 'tvshows' ||
                    selected.type === 'tv';

                const itemUrl = selected.link || selected.url;

                if (!itemUrl) {
                    await sendText(
                        socket,
                        sender,
                        `⚠️ No valid details URL was found.` + FOOTER,
                        reply
                    );

                    return;
                }

                await sendText(
                    socket,
                    sender,
                    `╭━━━〔 ⏳ FETCHING DETAILS 〕━━━╮\n\n` +
                    `${isTV ? '📺 Series' : '🎬 Movie'}: ` +
                    `${selected.title || 'Unknown'}\n` +
                    `_Loading information..._` +
                    FOOTER,
                    reply
                );

                const detailsResponse = await axios.get(
                    `${API_BASE}/api/v1/cartoons/sinhalacartoons/infodl`,
                    {
                        params: {
                            q: itemUrl,
                            api_key: API_KEY
                        },
                        timeout: 60000
                    }
                );

                const info = detailsResponse.data?.data || {};
                const title = info.title || selected.title || 'Unknown Title';
                const poster = info.image || selected.image || DEFAULT_IMAGE;

                // TV SERIES
                if (isTV) {
                    const episodes = Array.isArray(info.episodes)
                        ? info.episodes
                        : Array.isArray(info.downloads)
                            ? info.downloads
                            : [];

                    const caption =
                        `╭━━━〔 📺 SERIES DETAILS 〕━━━╮\n\n` +
                        `🎬 *Title:* ${title}\n` +
                        `⭐ *Rating:* ${info.rating || info.imdb || 'N/A'}\n` +
                        `📅 *Year:* ${info.year || selected.year || 'N/A'}\n` +
                        `📂 *Episodes:* ${episodes.length}` +
                        FOOTER;

                    await socket.sendMessage(
                        sender,
                        {
                            image: { url: poster },
                            caption
                        },
                        { quoted: reply }
                    );

                    if (!episodes.length) {
                        await sendText(
                            socket,
                            sender,
                            `⚠️ No episode links are available right now.` +
                            FOOTER,
                            reply
                        );

                        return;
                    }

                    let episodeText =
                        `╭━━━〔 📥 EPISODE LINKS 〕━━━╮\n\n` +
                        `📺 *${title}*\n\n`;

                    episodes.slice(0, 15).forEach((episode, i) => {
                        const url =
                            episode.download_link ||
                            episode.link ||
                            episode.url;

                        episodeText +=
                            `*Episode ${String(i + 1).padStart(2, '0')}*\n` +
                            `🎬 ${episode.name || episode.title || `Episode ${i + 1}`}\n` +
                            `🔗 ${url || 'Link unavailable'}\n\n`;
                    });

                    episodeText +=
                        `📌 _Up to 15 episodes shown._` + FOOTER;

                    await sendText(
                        socket,
                        sender,
                        episodeText,
                        reply
                    );

                    return;
                }

                // MOVIE DETAILS
                const genres = Array.isArray(info.genres)
                    ? info.genres.join(', ')
                    : info.genres || 'N/A';

                const story = info.story
                    ? (
                        info.story.length > 300
                            ? info.story.slice(0, 300) + '...'
                            : info.story
                    )
                    : 'N/A';

                const movieCaption =
                    `╭━━━〔 🎬 MOVIE DETAILS 〕━━━╮\n\n` +
                    `🎞️ *Title:* ${title}\n` +
                    `⭐ *IMDb:* ${info.imdb || info.rating || 'N/A'}\n` +
                    `📅 *Year:* ${info.year || selected.year || 'N/A'}\n` +
                    `⏱️ *Duration:* ${info.duration || 'N/A'}\n` +
                    `🌍 *Country:* ${info.country || 'N/A'}\n` +
                    `🎭 *Genres:* ${genres}\n\n` +
                    `📝 *Story:*\n${story}` +
                    FOOTER;

                await socket.sendMessage(
                    sender,
                    {
                        image: { url: poster },
                        caption: movieCaption
                    },
                    { quoted: reply }
                );

                const downloads = Array.isArray(info.downloads)
                    ? info.downloads.slice(0, 15)
                    : [];

                if (!downloads.length) {
                    await sendText(
                        socket,
                        sender,
                        `⚠️ No direct download options are available for this movie.` +
                        FOOTER,
                        reply
                    );

                    return;
                }

                let qualityText =
                    `╭━━━〔 📥 DOWNLOAD OPTIONS 〕━━━╮\n\n` +
                    `🎬 *${title}*\n\n`;

                downloads.forEach((download, i) => {
                    qualityText +=
                        `*${String(i + 1).padStart(2, '0')}.* ` +
                        `💾 ${download.quality || 'Direct MP4'}\n` +
                        `   📦 Size: ${download.size || 'Unknown'}\n\n`;
                });

                qualityText +=
                    `📌 *Reply with a number to receive the file.*` +
                    FOOTER;

                const qualityMessage = await socket.sendMessage(
                    sender,
                    { text: qualityText },
                    { quoted: reply }
                );

                const qualityMessageId = qualityMessage.key.id;

                let downloadBusy = false;

                const handleQualitySelection = async ({ messages }) => {
                    const qualityReply = messages?.[0];

                    if (!qualityReply?.message || qualityReply.key?.fromMe) return;
                    if (qualityReply.key?.remoteJid !== sender) return;
                    if (getReplyId(qualityReply) !== qualityMessageId) return;
                    if (downloadBusy) return;

                    const qualityChoiceText = getText(qualityReply);

                    if (!isValidNumber(qualityChoiceText)) return;

                    const qualityIndex = Number(qualityChoiceText) - 1;

                    if (
                        qualityIndex < 0 ||
                        qualityIndex >= downloads.length
                    ) {
                        await sendText(
                            socket,
                            sender,
                            `⚠️ Invalid quality number. Choose 1-${downloads.length}.`,
                            qualityReply
                        );

                        return;
                    }

                    downloadBusy = true;
                    socket.ev.off(
                        'messages.upsert',
                        handleQualitySelection
                    );

                    const download = downloads[qualityIndex];

                    const fileUrl =
                        download.link ||
                        download.download_link ||
                        download.direct_link;

                    if (!fileUrl) {
                        await sendText(
                            socket,
                            sender,
                            `⚠️ No valid download link was found.` + FOOTER,
                            qualityReply
                        );

                        return;
                    }

                    const quality = download.quality || 'HD';

                    await sendText(
                        socket,
                        sender,
                        `╭━━━〔 📤 SENDING FILE 〕━━━╮\n\n` +
                        `🎬 *Title:* ${title}\n` +
                        `💾 *Quality:* ${quality}\n` +
                        `⏳ _Preparing your file..._` +
                        FOOTER,
                        qualityReply
                    );

                    try {
                        await socket.sendMessage(
                            sender,
                            {
                                document: { url: fileUrl },
                                mimetype: 'video/mp4',
                                fileName:
                                    `${safeFilename(title)} (${safeFilename(quality)}).mp4`,
                                caption:
                                    `╭━━━〔 🤍 LUZZY MD 〕━━━╮\n\n` +
                                    `🎬 *Title:* ${title}\n` +
                                    `💾 *Quality:* ${quality}\n` +
                                    `📦 *Size:* ${download.size || 'Unknown'}` +
                                    FOOTER
                            },
                            { quoted: qualityReply }
                        );
                    } catch (uploadError) {
                        await sendText(
                            socket,
                            sender,
                            `⚠️ *Upload failed.*\n\n` +
                            `Reason: ${formatError(uploadError)}\n\n` +
                            `🔗 *Direct Link:*\n${fileUrl}` +
                            FOOTER,
                            qualityReply
                        );
                    }
                };

                socket.ev.on(
                    'messages.upsert',
                    handleQualitySelection
                );

            } catch (detailsError) {
                await sendText(
                    socket,
                    sender,
                    `╭━━━〔 ❌ DETAILS ERROR 〕━━━╮\n\n` +
                    `${formatError(detailsError)}` +
                    FOOTER,
                    reply
                );
            }
        };

        socket.ev.on('messages.upsert', handleSearchSelection);

    } catch (error) {
        await sendText(
            socket,
            sender,
            `╭━━━〔 ❌ SEARCH ERROR 〕━━━╮\n\n` +
            `Unable to search right now.\n` +
            `Reason: ${formatError(error)}` +
            FOOTER,
            msg
        );
    }
});
