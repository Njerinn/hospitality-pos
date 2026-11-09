import { buildApp } from './app.js';
import { config } from './config.js';
import { BUILD_SHA } from './build-sha.js';

async function main() {
  const app = await buildApp();
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  app.log.info({ sha: BUILD_SHA, env: config.NODE_ENV }, 'api booted');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
