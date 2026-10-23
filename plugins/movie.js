import { cmd } from '../command.js';
import axios from 'axios';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);

cmd({
    pattern: "cinesubz",
    alias: ["cs"],
    desc: "Sinhala subtitles movies, TV series and direct downloads",
    category: "download",
    react: "🎥",
    filename: __filename
},
async (socket, msg, m, { from, args }) => {
    const sender = from;
    const DEFAULT_FOOTER = `\n\n> 🎭 𝗖𝗛𝗔𝗠𝗔 𝗖𝗜𝗡𝗘 𝗛𝗨𝗕 🎭\n> 🧬 ᴘᴏᴡᴇʀᴇᴅ ʙʏ 🇨🇭𝗔𝗠𝗔 𝗧𝗘𝗖𝗛`;

    if (!args.length) {
        await socket.sendMessage(sender, {
            text: `*❪ ERROR ❫*\n\n⚠️ *Invalid Usage!*\n\n🎬 *Example:*\n• .cinesubz avatar\n• .cinesubz game of thrones\n\n📝 _Please provide the Movie or Series name!_${DEFAULT_FOOTER}`
        }, { quoted: msg });
        break;
    }

    const query = args.join(' ').trim();
    const API_BASE = "https://api.chamindu.site";
    const API_KEY = "chama_api_9d3e78236d1d8e63def0761c1831b855";
    const DEFAULT_IMAGE = "https://api.chamindu.site/logo.png";

    await socket.sendMessage(sender, { 
        text: `*❪ SEARCHING ❫*\n\n🔍 *Searching CineSubz (CineTV) for:* _${query}_\n⚡ _Please wait a moment..._`
    }, { quoted: msg });

    try {
        const res = await axios.get(`${API_BASE}/api/v1/movie/cinesubz/search?q=${encodeURIComponent(query)}&api_key=${API_KEY}`);
        const results = res.data.data || res.data.results || [];

        if (!results.length) {
            await socket.sendMessage(sender, {
                text: `*❪ NO RESULTS ❫*\n\n😞 *No Results Found on CineSubz (CineTV)!*\n🎬 *Query:* _${query}_${DEFAULT_FOOTER}`
            }, { quoted: msg });
            break;
        }

        let listText = `*❪ CINESUBZ (CINETV) SEARCH RESULTS ❫*\n\n🎯 *Query:* _${query}_\n📊 *Total:* _${results.length} Items_\n\n*👇 SELECT A NUMBER 👇*\n\n`;

        results.slice(0, 15).forEach((item, index) => {
            const num = (index + 1) < 10 ? `0${index + 1}` : `${index + 1}`;
            const typeIcon = (item.type === 'tvshows' || item.type === 'tv') ? '📺' : '🎥';
            listText += `*${num}* ➜ ${typeIcon} _${(item.title || 'Movie').substring(0, 32)}_ (${item.year || 'N/A'})\n`;
        });

        listText += `\n📌 _Reply with the number to download!_${DEFAULT_FOOTER}`;
        const sentMsg = await socket.sendMessage(sender, { text: listText }, { quoted: msg });
        const messageID = sentMsg.key.id;

        const handleSelection = async ({ messages: replyMessages }) => {
            const replyMek = replyMessages[0];
            if (!replyMek?.message) return;

            const messageType = replyMek.message.conversation || replyMek.message.extendedTextMessage?.text;
            const isReplyToSentMsg = replyMek.message.extendedTextMessage?.contextInfo?.stanzaId === messageID;

            if (isReplyToSentMsg && sender === replyMek.key.remoteJid) {
                const choice = parseInt(messageType) - 1;
                if (isNaN(choice) || choice < 0 || choice >= results.length) {
                    await socket.sendMessage(sender, {
                        text: `⚠️ *Invalid choice! Range: 01 - ${results.length}*`
                    }, { quoted: replyMek });
                    return;
                }

                const selectedItem = results[choice];
                const isTvShow = selectedItem.type === 'tvshows' || selectedItem.type === 'tv';

                if (isTvShow) {
                    await socket.sendMessage(sender, { 
                        text: `*❪ FETCHING ❫*\n\n📺 *Fetching TV Series details from CINESUBZ (CINETV)...*\n⚡ _Please wait..._`
                    }, { quoted: replyMek });

                    try {
                        const tvRes = await axios.get(`${API_BASE}/api/v1/movie/cinesubz/infodl?q=${encodeURIComponent(selectedItem.link || selectedItem.url)}&api_key=${API_KEY}`);
                        const tvData = tvRes.data;
                        const tvInfo = tvData.data || {};
                        const episodes = tvInfo.episodes || tvInfo.downloads || [];

                        let tvText = `*❪ TV SERIES DETAILS ❫*\n\n📺 *${tvInfo.title || selectedItem.title}*\n⭐ *Rating:* ★ ${tvInfo.rating || tvInfo.imdb || 'N/A'}\n📅 *Year:* ${tvInfo.year || 'N/A'}\n🎬 *Episodes:* ${episodes.length}\n${DEFAULT_FOOTER}`;
                        await socket.sendMessage(sender, {
                            image: { url: tvInfo.image || selectedItem.image || DEFAULT_IMAGE },
                            caption: tvText
                        }, { quoted: replyMek });

                        if (episodes.length > 0) {
                            let epListText = `*❪ EPISODE DOWNLOADS ❫*\n\n📺 *Series:* _${tvInfo.title || selectedItem.title}_\n\n`;
                            episodes.slice(0, 15).forEach((ep, epIdx) => {
                                epListText += `*Episode ${epIdx + 1}:* ${ep.name || ep.title || 'Episode ' + (epIdx + 1)}\n🔗 ${ep.download_link || ep.link || ep.url}\n\n`;
                            });
                            epListText += DEFAULT_FOOTER;
                            await socket.sendMessage(sender, { text: epListText }, { quoted: replyMek });
                        }
                    } catch (tvErr) {
                        await socket.sendMessage(sender, { text: `❌ *TV Show Error:* ${tvErr.message}${DEFAULT_FOOTER}` }, { quoted: replyMek });
                    }
                    socket.ev.off('messages.upsert', handleSelection);
                    return;
                }

                // MOVIE FLOW
                await socket.sendMessage(sender, { 
                    text: `*❪ FETCHING ❫*\n\n🎬 *Fetching Movie details from CineSubz (CineTV)...*\n⚡ _Please wait..._`
                }, { quoted: replyMek });

                try {
                    const detailsRes = await axios.get(`${API_BASE}/api/v1/movie/cinesubz/infodl?q=${encodeURIComponent(selectedItem.link || selectedItem.url)}&api_key=${API_KEY}`);
                    const detailsData = detailsRes.data;
                    const movieInfo = detailsData.data || {};
                    const validDownloads = movieInfo.downloads || [];

                    const movieDetailsText = `*❪ MOVIE DETAILS ❫*\n\n🎬 *${movieInfo.title || selectedItem.title}*\n⭐ 𝗜𝗠𝗗𝗕 ➜ ★ ${movieInfo.imdb || movieInfo.rating || 'N/A'}\n📅 𝗬𝗲𝗮𝗿 ➜ ${movieInfo.year || 'N/A'}\n⏳ 𝗗𝘂𝗿𝗮𝘁𝗶𝗼𝗻 ➜ ${movieInfo.duration || 'N/A'}\n🌍 𝗖𝗼𝘂𝗻𝘁𝗿𝘆 ➜ ${movieInfo.country || 'N/A'}\n🎭 𝗚𝗲𝗻𝗿𝗲𝘀 ➜ ${Array.isArray(movieInfo.genres) ? movieInfo.genres.join(', ') : (movieInfo.genres || 'N/A')}\n📝 𝗦𝘁𝗼𝗿𝘆 ➜ ${movieInfo.story ? (movieInfo.story.length > 220 ? movieInfo.story.substring(0, 220) + '...' : movieInfo.story) : 'N/A'}\n${DEFAULT_FOOTER}`;

                    const posterUrl = movieInfo.image || selectedItem.image || DEFAULT_IMAGE;
                    await socket.sendMessage(sender, {
                        image: { url: posterUrl },
                        caption: movieDetailsText
                    }, { quoted: replyMek });

                    if (validDownloads.length === 0) {
                        await socket.sendMessage(sender, {
                            text: `⚠️ *No Direct Downloads available for this movie right now.*${DEFAULT_FOOTER}`
                        }, { quoted: replyMek });
                        socket.ev.off('messages.upsert', handleSelection);
                        return;
                    }

                    const downloadOptionsText = `*❪ DOWNLOAD QUALITIES ❫*\n\n📥 *Select Quality:*\n\n` + 
                        validDownloads.map((dl, i) => {
                            const num = (i + 1) < 10 ? `0${i + 1}` : `${i + 1}`;
                            return `*${num}* ➜ 💾 _${dl.quality || 'Direct MP4'}_ (${dl.size || 'Direct'})`;
                        }).join('\n') + `\n\n📌 _Reply with the number to send file!_${DEFAULT_FOOTER}`;

                    const dlSentMsg = await socket.sendMessage(sender, { text: downloadOptionsText }, { quoted: replyMek });
                    const dlMessageID = dlSentMsg.key.id;

                    const handleDownloadSelection = async ({ messages: dlReplyMessages }) => {
                        const dlReplyMek = dlReplyMessages[0];
                        if (!dlReplyMek?.message) return;
                        const dlChoiceText = dlReplyMek.message.conversation || dlReplyMek.message.extendedTextMessage?.text;
                        const isReplyToDlMsg = dlReplyMek.message.extendedTextMessage?.contextInfo?.stanzaId === dlMessageID;

                        if (isReplyToDlMsg && sender === dlReplyMek.key.remoteJid) {
                            const dlChoice = parseInt(dlChoiceText) - 1;
                            if (isNaN(dlChoice) || dlChoice < 0 || dlChoice >= validDownloads.length) {
                                await socket.sendMessage(sender, { text: `⚠️ *Invalid quality number!*` }, { quoted: dlReplyMek });
                                return;
                            }

                            const selectedDownload = validDownloads[dlChoice];
                            const fileUrl = selectedDownload.link || selectedDownload.download_link || selectedDownload.direct_link;

                            await socket.sendMessage(sender, { 
                                text: `*❪ SENDING MOVIE ❫*\n\n📥 *Sending:* _${movieInfo.title || selectedItem.title}_\n📊 *Quality:* _${selectedDownload.quality || 'HD'}_\n⚡ _Uploading file to WhatsApp..._`
                            }, { quoted: dlReplyMek });

                            try {
                                await socket.sendMessage(sender, {
                                    document: { url: fileUrl },
                                    mimetype: 'video/mp4',
                                    fileName: `${movieInfo.title || 'Movie'} (${selectedDownload.quality || 'HD'}).mp4`,
                                    caption: `*🎬 𝗖𝗛𝗔𝗠𝗔 𝗖𝗜𝗡𝗘 𝗠𝗢𝗩𝗜𝗘 🎬*\n\n🎭 *Title:* ${movieInfo.title || selectedItem.title}\n📊 *Quality:* ${selectedDownload.quality || 'HD'}\n💾 *Size:* ${selectedDownload.size || 'Direct'}${DEFAULT_FOOTER}`
                                }, { quoted: dlReplyMek });
                            } catch (sendErr) {
                                await socket.sendMessage(sender, {
                                    text: `⚠️ *Direct upload error:* ${sendErr.message}\n\n🔗 *Direct Link:* ${fileUrl}${DEFAULT_FOOTER}`
                                }, { quoted: dlReplyMek });
                            }
                            socket.ev.off('messages.upsert', handleDownloadSelection);
                        }
                    };
                    socket.ev.on('messages.upsert', handleDownloadSelection);

                } catch (detailsErr) {
                    await socket.sendMessage(sender, { text: `❌ *Details Error:* ${detailsErr.message}${DEFAULT_FOOTER}` }, { quoted: replyMek });
                }

                socket.ev.off('messages.upsert', handleSelection);
            }
        };
        socket.ev.on('messages.upsert', handleSelection);

    } catch (err) {
        await socket.sendMessage(sender, {
            text: `*❪ ERROR ❫*\n\n❌ *Search Error:* ${err.message}${DEFAULT_FOOTER}`
        }, { quoted: msg });
    }
});
