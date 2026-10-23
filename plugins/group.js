const { cmd } = require('../command');
const { jidNormalizedUser } = require('@whiskeysockets/baileys');

// common checks for admin-only commands
function guard(f, { isGroup, isAdmins, isOwner, isBotAdmins, reply }, needBotAdmin = true) {
  if (!isGroup) { reply('❗ This command works in groups only.'); return false; }
  if (!isAdmins && !isOwner) { reply('⛔ Only group admins can use this.'); return false; }
  if (needBotAdmin && !isBotAdmins) { reply('⚠️ Make me an admin first.'); return false; }
  return true;
}

// first @mentioned user, or the person whose message you replied to
const getTarget = (m) => (m.mentionUser && m.mentionUser[0] ? jidNormalizedUser(m.mentionUser[0]) : null);

// .groupinfo
cmd({ pattern: 'groupinfo', alias: ['ginfo'], desc: 'Show group details', category: 'group', react: 'ℹ️', filename: __filename },
async (danuwa, mek, m, ctx) => {
  const { isGroup, groupName, participants, groupAdmins, groupMetadata, reply } = ctx;
  if (!isGroup) return reply('❗ This command works in groups only.');
  const created = groupMetadata.creation ? new Date(groupMetadata.creation * 1000).toLocaleDateString('en-GB') : 'Unknown';
  reply(`ℹ️ *Group Info*\n\n*Name:* ${groupName}\n*Members:* ${participants.length}\n*Admins:* ${groupAdmins.length}\n*Created:* ${created}\n*Description:* ${groupMetadata.desc || 'None'}`);
});

// .tagall [message]
cmd({ pattern: 'tagall', desc: 'Mention everyone (admins)', category: 'group', react: '📢', filename: __filename },
async (danuwa, mek, m, ctx) => {
  if (!guard('tagall', ctx, false)) return;
  const { from, participants, q } = ctx;
  let text = `📢 *${q || 'Attention everyone!'}*\n\n`;
  participants.forEach((p) => { text += `@${p.id.split('@')[0]}\n`; });
  await danuwa.sendMessage(from, { text, mentions: participants.map((p) => p.id) }, { quoted: mek });
});

// .kick @user  (or reply to their message)
cmd({ pattern: 'kick', alias: ['remove'], desc: 'Remove a member (admins)', category: 'group', react: '🦵', filename: __filename },
async (danuwa, mek, m, ctx) => {
  if (!guard('kick', ctx)) return;
  const { from, reply, groupAdmins, botNumber2 } = ctx;
  const target = getTarget(m);
  if (!target) return reply('❗ Mention or reply to the person. Eg: .kick @user');
  if (target === botNumber2) return reply('😅 I can\'t kick myself.');
  if (groupAdmins.includes(target)) return reply('⛔ I won\'t remove an admin.');
  await danuwa.groupParticipantsUpdate(from, [target], 'remove');
  reply(`✅ Removed @${target.split('@')[0]}`);
});

// .promote @user
cmd({ pattern: 'promote', desc: 'Make someone admin (admins)', category: 'group', react: '⬆️', filename: __filename },
async (danuwa, mek, m, ctx) => {
  if (!guard('promote', ctx)) return;
  const { from, reply } = ctx;
  const target = getTarget(m);
  if (!target) return reply('❗ Mention or reply to the person. Eg: .promote @user');
  await danuwa.groupParticipantsUpdate(from, [target], 'promote');
  reply(`✅ @${target.split('@')[0]} is now an admin.`);
});

// .demote @user
cmd({ pattern: 'demote', desc: 'Remove admin rights (admins)', category: 'group', react: '⬇️', filename: __filename },
async (danuwa, mek, m, ctx) => {
  if (!guard('demote', ctx)) return;
  const { from, reply } = ctx;
  const target = getTarget(m);
  if (!target) return reply('❗ Mention or reply to the person. Eg: .demote @user');
  await danuwa.groupParticipantsUpdate(from, [target], 'demote');
  reply(`✅ @${target.split('@')[0]} is no longer an admin.`);
});

// .mute / .unmute  (only admins can send / everyone can send)
cmd({ pattern: 'mute', desc: 'Only admins can chat (admins)', category: 'group', react: '🔇', filename: __filename },
async (danuwa, mek, m, ctx) => {
  if (!guard('mute', ctx)) return;
  await danuwa.groupSettingUpdate(ctx.from, 'announcement');
  ctx.reply('🔇 Group muted. Only admins can send messages.');
});
cmd({ pattern: 'unmute', desc: 'Everyone can chat (admins)', category: 'group', react: '🔊', filename: __filename },
async (danuwa, mek, m, ctx) => {
  if (!guard('unmute', ctx)) return;
  await danuwa.groupSettingUpdate(ctx.from, 'not_announcement');
  ctx.reply('🔊 Group unmuted. Everyone can send messages.');
});

// .link
cmd({ pattern: 'link', alias: ['grouplink'], desc: 'Get the group invite link (admins)', category: 'group', react: '🔗', filename: __filename },
async (danuwa, mek, m, ctx) => {
  if (!guard('link', ctx)) return;
  const code = await danuwa.groupInviteCode(ctx.from);
  ctx.reply(`🔗 https://chat.whatsapp.com/${code}`);
});
