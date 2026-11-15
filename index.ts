import app from './src/app.js';
import config from './src/config.js';

const PORT = config.port;

console.log(`Server running at http://0.0.0.0:${PORT}`);

export default {
  port: PORT,
  hostname: '0.0.0.0',
  fetch: app.fetch,
};
