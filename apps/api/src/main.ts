import { buildApp } from './app.js';
import { config } from './config.js';
import { BUILD_SHA } from './build-sha.js';
import { startEtimsWorker } from './modules/etims/worker.js';
import { etimsConfig } from './modules/etims/config.js';
import { startMockEtimsServer } from './modules/etims/mock-server.js';

async function main() {
  const app = await buildApp();
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  app.log.info({ sha: BUILD_SHA, env: config.NODE_ENV }, 'api booted');

  if (process.env.NODE_ENV !== 'test') {
    let mockBaseUrl: string | undefined;
    if (etimsConfig.ETIMS_MOCK_ENABLED) {
      const mock = await startMockEtimsServer();
      mockBaseUrl = mock.url;
      app.log.warn({ mockBaseUrl }, 'ETIMS_MOCK_ENABLED=true — mock KRA server started (no real fiscal submission)');
    }
    startEtimsWorker(app, { mockBaseUrl });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
