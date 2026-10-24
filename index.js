const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  jidNormalizedUser,
  getContentType,
  fetchLatestBaileysVersion,
  Browsers
} = require('@whiskeysockets/baileys');

const fs = require('fs');
const P = require('pino');
const express = require('express');
const path = require('path');

const config = require('./config');
const { sms } = require('./lib/msg');
const { getGroupAdmins } = require('./lib/functions');
const { File } = require('megajs');
const { commands, replyHandlers } = require('./command');

const app = express();
const port = process.env.PORT || 8000;

const prefix = config.PREFIX;
const ownerNumber = [config.BOT_OWNER];
const authDir = process.env.AUTH_DIR || path.join(__dirname, 'auth_info_baileys');
const pairPage = require('./lib/pairpage');

let sock = null;
let sockReady = false; // true once WhatsApp is ready to give a pairing code
const credsPath = path.join(authDir, 'creds.json');

// Don't let one bad promise kill the whole bot
process.on('unhandledRejection', (err) => console.error('[UNHANDLED REJECTION]', err));
process.on('uncaughtException', (err) => console.error('[UNCAUGHT EXCEPTION]', err));

// ---------- Load plugins ONCE at startup (not on every reconnect) ----------
function loadPlugins() {
  const dir = path.join(__dirname, 'plugins');
  fs.readdirSync(dir).forEach((plugin) => {
    if (path.extname(plugin).toLowerCase() === '.js') {
      try {
        require(path.join(dir, plugin));
        console.log(`🔌 Plugin loaded: ${plugin}`);
      } catch (e) {
        console.error(`❌ Failed to load plugin ${plugin}:`, e);
      }
    }
  });
}

// ---------- Session restore from MEGA ----------
async function ensureSessionFile() {
  if (fs.existsSync(credsPath)) {
    return setTimeout(connectToWA, 1000);
  }

  if (!config.SESSION_ID) {
    console.log('🔗 No session found. Open the bot web page and pair with your number.');
    return setTimeout(connectToWA, 1000);
  }

  console.log('🔄 creds.json not found. Downloading session from MEGA...');
  const filer = File.fromURL(`https://mega.nz/file/${config.SESSION_ID}`);

  filer.download((err, data) => {
    if (err) {
      console.error('❌ Failed to download session file from MEGA:', err);
      process.exit(1);
    }
    fs.mkdirSync(authDir, { recursive: true });
    fs.writeFileSync(credsPath, data);
    console.log('✅ Session downloaded and saved. Connecting...');
    setTimeout(connectToWA, 2000);
  });
}

let sentStartupMsg = false;

async function connectToWA() {
  console.log('Connecting DANUWA-MD 🧬...');
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  const danuwa = makeWASocket({
    logger: P({ level: 'silent' }),
    printQRInTerminal: false,
    browser: Browsers.macOS('Chrome'),
    auth: state,
    version,
    syncFullHistory: false, // true makes the bot re-process OLD messages
    markOnlineOnConnect: true,
    generateHighQualityLinkPreview: true,
  });

  sock = danuwa;
  sockReady = false;
  // Don't wait only for the QR event: after a short delay the socket is ready for a pairing code
  if (!state.creds.registered) {
    setTimeout(() => { if (sock === danuwa) sockReady = true; }, 4000);
  }

  danuwa.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if (update.qr) sockReady = true; // QR event = ready for pairing code

    if (connection === 'close') {
      sockReady = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.error('❌ Logged out. Clearing session, pair again from the web page.');
        fs.rmSync(authDir, { recursive: true, force: true });
        setTimeout(connectToWA, 2000);
      } else {
        console.log(`⚠️ Connection closed (code ${code}). Reconnecting in 3s...`);
        setTimeout(connectToWA, 3000);
      }
    } else if (connection === 'open') {
      console.log('✅ DANUWA-MD connected to WhatsApp');

      if (!sentStartupMsg) {
        sentStartupMsg = true;
        try {
          await danuwa.sendMessage(ownerNumber[0] + '@s.whatsapp.net', {
            image: { url: config.ALIVE_IMG },
            caption: `DANUWA-MD connected ✅\n\nPREFIX: ${prefix}`,
          });
        } catch (e) {
          console.error('Could not send startup message:', e.message);
        }
      }
    }
  });

  danuwa.ev.on('creds.update', saveCreds);

  danuwa.ev.on('messages.upsert', async ({ messages, type: upsertType }) => {
    // Only live messages. 'append' = old/history messages -> would re-run old commands
    if (upsertType !== 'notify') return;

    for (const msg of messages) {
      try {
        await handleMessage(danuwa, msg);
      } catch (e) {
        console.error('[MESSAGE ERROR]', e);
      }
    }
  });
}

async function handleMessage(danuwa, mek) {
  if (mek.messageStubType === 68) {
    await danuwa.sendMessageAck(mek.key).catch(() => {});
  }

  if (!mek || !mek.message) return;

  mek.message =
    getContentType(mek.message) === 'ephemeralMessage'
      ? mek.message.ephemeralMessage.message
      : mek.message;
  if (!mek.message) return;
  if (mek.key.remoteJid === 'status@broadcast') return;

  const m = sms(danuwa, mek);
  const type = getContentType(mek.message);
  const from = mek.key.remoteJid;
  const body =
    type === 'conversation'
      ? mek.message.conversation
      : mek.message[type]?.text || mek.message[type]?.caption || '';
  const isCmd = body.startsWith(prefix);
  const commandName = isCmd ? body.slice(prefix.length).trim().split(/\s+/)[0].toLowerCase() : '';
  const args = body.trim().split(/\s+/).slice(1);
  const q = args.join(' ');

  const botNumber2 = jidNormalizedUser(danuwa.user.id); // 9477xxxx@s.whatsapp.net (no :device part)
  const botNumber = botNumber2.split('@')[0];
  // normalise sender so it has no ":device" suffix (this broke isMe / isAdmins before)
  const sender = jidNormalizedUser(
    mek.key.fromMe ? danuwa.user.id : mek.key.participant || mek.key.remoteJid
  );
  const senderNumber = sender.split('@')[0];
  const isGroup = from.endsWith('@g.us');
  const pushname = mek.pushName || 'Unknown';
  const isMe = botNumber === senderNumber;
  const isOwner = ownerNumber.includes(senderNumber) || isMe;

  let groupMetadata = {};
  let groupName = '';
  let participants = [];
  let groupAdmins = [];
  if (isGroup) {
    groupMetadata = (await danuwa.groupMetadata(from).catch(() => null)) || {};
    groupName = groupMetadata.subject || '';
    participants = groupMetadata.participants || [];
    groupAdmins = getGroupAdmins(participants);
  }
  const isBotAdmins = isGroup ? groupAdmins.includes(botNumber2) : false;
  const isAdmins = isGroup ? groupAdmins.includes(sender) : false;

  const reply = (text) => danuwa.sendMessage(from, { text }, { quoted: mek });

  const extra = {
    from, quoted: mek, body, isCmd, command: commandName, args, q,
    isGroup, sender, senderNumber, botNumber2, botNumber, pushname,
    isMe, isOwner, groupMetadata, groupName, participants, groupAdmins,
    isBotAdmins, isAdmins, reply,
  };

  if (isCmd) {
    const cmd = commands.find(
      (c) => c.pattern === commandName || (c.alias && c.alias.includes(commandName))
    );
    if (cmd) {
      if (cmd.react) danuwa.sendMessage(from, { react: { text: cmd.react, key: mek.key } }).catch(() => {});
      try {
        await cmd.function(danuwa, mek, m, extra); // await, so async errors are actually caught
      } catch (e) {
        console.error('[PLUGIN ERROR]', e);
      }
    }
  }

  for (const handler of replyHandlers) {
    try {
      if (handler.filter(body, { sender, message: mek })) {
        await handler.function(danuwa, mek, m, { ...extra, body });
        break;
      }
    } catch (e) {
      console.error('Reply handler error:', e);
    }
  }
}

loadPlugins();
ensureSessionFile();

app.get('/', (req, res) => res.send(pairPage));

app.get('/status', (req, res) => {
  res.json({ linked: !!(sock && sock.authState.creds.registered) });
});

app.get('/pair', async (req, res) => {
  const number = String(req.query.number || '').replace(/\D/g, '');
  if (number.length < 8) return res.status(400).json({ error: 'Invalid number' });
  if (!sock) return res.status(503).json({ error: 'Bot is starting, try again in a few seconds' });
  if (sock.authState.creds.registered) return res.json({ error: 'Already linked ✅' });

  for (let i = 0; i < 30 && !sockReady; i++) await new Promise((r) => setTimeout(r, 500));
  if (!sockReady) return res.status(503).json({ error: 'Not ready yet, try again' });

  try {
    const code = await sock.requestPairingCode(number);
    res.json({ code: code.match(/.{1,4}/g).join('-') });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(port, () => console.log(`Server listening on http://localhost:${port}`));
