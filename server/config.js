const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const env = process.env;
const angel = {
  apiKey: env.ANGEL_API_KEY || '',
  clientCode: env.ANGEL_CLIENT_CODE || '',
  pin: env.ANGEL_PIN || '',
  totpSecret: (env.ANGEL_TOTP_SECRET || '').replace(/\s+/g, ''),
};

module.exports = {
  port: Number(env.PORT) || 3000,
  host: env.HOST || '127.0.0.1',
  angel,
  useAngel: Boolean(angel.apiKey && angel.clientCode && angel.pin && angel.totpSecret),
  dataDir: path.join(__dirname, '..', 'data'),
  publicDir: path.join(__dirname, '..', 'public'),
};
