import { FastifyInstance } from 'fastify';
import { BUILD_SHA } from '../../build-sha.js';

export async function healthRoutes(app: FastifyInstance) {
  // Intentionally dependency-free for fast cold-start and Render uptime pings.
  app.get('/health', async () => ({ status: 'ok', sha: BUILD_SHA }));
}
