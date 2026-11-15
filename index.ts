import app from './src/app.js';
import config from './src/config.js';

if (typeof Bun !== 'undefined') {
  console.log(`Server running at http://0.0.0.0:${config.port}`);
  Bun.serve({
    port: config.port,
    hostname: '0.0.0.0',
    fetch: app.fetch,
  });
}

export default app;
