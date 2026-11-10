import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distPath = resolve(__dirname, '..', 'apps', 'api', 'dist', 'build-sha.js');

function resolveSha() {
  if (process.env.RENDER_GIT_COMMIT) return process.env.RENDER_GIT_COMMIT;
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execSync('git rev-parse HEAD', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'dev';
  }
}

const sha = resolveSha();
const content = readFileSync(distPath, 'utf8');
const replaced = content.replace(/'BUILD_SHA_PLACEHOLDER'/g, `'${sha}'`);
if (replaced === content) {
  console.error(`❌ placeholder not found in ${distPath}`);
  process.exit(1);
}
writeFileSync(distPath, replaced);
console.log(`✅ baked BUILD_SHA='${sha}' into ${distPath}`);
