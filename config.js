const fs = require('fs');
if (fs.existsSync('config.env')) require('dotenv').config({ path: './config.env' });

function convertToBool(text, fault = 'true') {
  return text === fault;
}

module.exports = {
  SESSION_ID: process.env.SESSION_ID || 'eewgmbLZ#y57beZZM7ggeqJ5ygwgP54VY66I-KmzWjOB87TWLiCs',
  ALIVE_IMG: process.env.ALIVE_IMG || 'https://raw.githubusercontent.com/gaveshvimanshna633-a11y/Bot-1/refs/heads/main/file_00000000aabc81f4bdd6f514b9b14978.png',
  ALIVE_MSG: process.env.ALIVE_MSG || '*Hello👋 DANUWA-MD Is Alive Now😍 fuck*',
  BOT_OWNER: process.env.BOT_OWNER || '94742549935', // owner's phone number (country code, no +)
  convertToBool,
};
