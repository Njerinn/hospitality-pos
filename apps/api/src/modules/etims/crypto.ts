// Patch 008D: AES-256-GCM encryption for cmcKey at-rest storage.
// Format: `${iv_base64}:${authTag_base64}:${ciphertext_base64}` — self-describing.
// Production requires ETIMS_CMC_KEY_ENCRYPTION_SECRET (≥32 chars). Dev uses a
// loud, deterministic fallback so local dev is never blocked.
import crypto from 'node:crypto';
import { etimsConfig } from './config.js';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;   // 96-bit IV, GCM standard
const TAG_LEN = 16;  // 128-bit auth tag

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = etimsConfig.ETIMS_CMC_KEY_ENCRYPTION_SECRET;
  if (secret) {
    const buf = Buffer.from(secret, 'utf8');
    if (buf.length < 32) {
      throw new Error('ETIMS_CMC_KEY_ENCRYPTION_SECRET must be >= 32 bytes');
    }
    cachedKey = buf.subarray(0, 32);
    return cachedKey;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('ETIMS_CMC_KEY_ENCRYPTION_SECRET required in production');
  }
  const fallback = crypto
    .createHash('sha256')
    .update('dev-only-insecure:' + (process.env.JWT_SECRET ?? 'no-jwt'))
    .digest();
  console.warn('[etims/crypto] DEV-ONLY fallback key — set ETIMS_CMC_KEY_ENCRYPTION_SECRET');
  cachedKey = fallback;
  return cachedKey;
}

export function encryptCmcKey(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decryptCmcKey(ciphertext: string): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 3) throw new Error('invalid cmcKey ciphertext format');
  const [ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  if (iv.length !== IV_LEN) throw new Error('invalid iv length');
  if (tag.length !== TAG_LEN) throw new Error('invalid auth tag length');
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

export function __resetCryptoCacheForTests(): void {
  cachedKey = null;
}
