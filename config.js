const fs = require('fs');
if (fs.existsSync('config.env')) require('dotenv').config({ path: './config.env' });

function convertToBool(text, fault = 'true') {
  return text === fault;
}

module.exports = {
  SESSION_ID: process.env.SESSION_ID || '',
  ALIVE_IMG: process.env.ALIVE_IMG || 'https://github.com/DANUWA-MD/DANUWA-MD/blob/main/images/DANUWA-MD.png?raw=true',
  ALIVE_MSG: process.env.ALIVE_MSG || '*Hello👋 DANUWA-MD Is Alive Now😍*',
  BOT_OWNER: process.env.BOT_OWNER || '94742549935', // owner's phone number (country code, no +)
  convertToBool,
};
