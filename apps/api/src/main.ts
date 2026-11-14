import { buildApp } from './app.js';
import { config } from './config.js';
import { BUILD_SHA } from './build-sha.js';
import { startEtimsWorker } from './modules/etims/worker.js';

async function main() {
  const app = await buildApp();
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  app.log.info({ sha: BUILD_SHA, env: config.NODE_ENV }, 'api booted');

  if (process.env.NODE_ENV !== 'test') {
    startEtimsWorker(app);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
