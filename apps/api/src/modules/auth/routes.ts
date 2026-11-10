import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import { randomBytes, createHash } from 'node:crypto';
import { pool } from '../../db/pool.js';
import { config } from '../../config.js';

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const secret = new TextEncoder().encode(config.JWT_SECRET);

function parseTtl(ttl: string): number {
  const m = ttl.match(/^(\d+)([smhd])$/);
  if (!m) return 15 * 60;
  const n = Number(m[1]);
  const unit = m[2];
  const factor = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400;
  return n * factor;
}

const ACCESS_TTL_SECONDS = parseTtl(config.ACCESS_TOKEN_TTL);
const REFRESH_TTL_SECONDS = config.REFRESH_TOKEN_DAYS * 24 * 60 * 60;

interface UserRow {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string;
  role: string;
}

function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

async function mintAccessToken(claims: { sub: string; tenant_id: string; role: string }): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(config.ACCESS_TOKEN_TTL)
    .sign(secret);
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/login', async (req, reply) => {
    const body = LoginBody.parse(req.body);
    const { rows } = await pool.query<UserRow>(
      `SELECT id, tenant_id, email, password_hash, role
       FROM users WHERE email = $1 LIMIT 1`,
      [body.email],
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(body.password, user.password_hash))) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }

    const access = await mintAccessToken({
      sub: user.id,
      tenant_id: user.tenant_id,
      role: user.role,
    });
    const rawRefresh = newRefreshToken();
    const refreshHash = hashRefreshToken(rawRefresh);
    const refreshExpires = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);
    await pool.query(
      `INSERT INTO auth_refresh_tokens (tenant_id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [user.tenant_id, user.id, refreshHash, refreshExpires],
    );

    const secureCookie = config.NODE_ENV !== 'development';
    reply.setCookie(config.SESSION_COOKIE_NAME, access, {
      httpOnly: true, secure: secureCookie, sameSite: 'strict',
      path: '/', maxAge: ACCESS_TTL_SECONDS,
    });
    reply.setCookie(config.REFRESH_COOKIE_NAME, rawRefresh, {
      httpOnly: true, secure: secureCookie, sameSite: 'strict',
      path: '/auth', maxAge: REFRESH_TTL_SECONDS,
    });
    return { ok: true };
  });

  app.post('/refresh', async (req, reply) => {
    const raw = req.cookies[config.REFRESH_COOKIE_NAME];
    if (!raw) {
      return reply.code(401).send({ error: 'no_refresh_token' });
    }
    const hash = hashRefreshToken(raw);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const sel = await client.query<{
        id: string;
        tenant_id: string;
        user_id: string;
        expires_at: Date;
        role: string;
      }>(
        `SELECT r.id, r.tenant_id, r.user_id, r.expires_at, u.role
         FROM auth_refresh_tokens r
         JOIN users u ON u.id = r.user_id
         WHERE r.token_hash = $1
         FOR UPDATE`,
        [hash],
      );
      const row = sel.rows[0];
      if (!row || new Date(row.expires_at).getTime() < Date.now()) {
        if (row) {
          await client.query('DELETE FROM auth_refresh_tokens WHERE id = $1', [row.id]);
        }
        await client.query('COMMIT');
        reply.clearCookie(config.SESSION_COOKIE_NAME, { path: '/' });
        reply.clearCookie(config.REFRESH_COOKIE_NAME, { path: '/auth' });
        return reply.code(401).send({ error: 'invalid_refresh_token' });
      }
      await client.query('DELETE FROM auth_refresh_tokens WHERE id = $1', [row.id]);
      const newRaw = newRefreshToken();
      const newHash = hashRefreshToken(newRaw);
      const newExpires = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);
      await client.query(
        `INSERT INTO auth_refresh_tokens (tenant_id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [row.tenant_id, row.user_id, newHash, newExpires],
      );
      await client.query('COMMIT');

      const newAccess = await mintAccessToken({
        sub: row.user_id,
        tenant_id: row.tenant_id,
        role: row.role,
      });
      const secureCookie = config.NODE_ENV !== 'development';
      reply.setCookie(config.SESSION_COOKIE_NAME, newAccess, {
        httpOnly: true, secure: secureCookie, sameSite: 'strict',
        path: '/', maxAge: ACCESS_TTL_SECONDS,
      });
      reply.setCookie(config.REFRESH_COOKIE_NAME, newRaw, {
        httpOnly: true, secure: secureCookie, sameSite: 'strict',
        path: '/auth', maxAge: REFRESH_TTL_SECONDS,
      });
      return { ok: true };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  app.post('/logout', async (req, reply) => {
    const raw = req.cookies[config.REFRESH_COOKIE_NAME];
    if (raw) {
      const hash = hashRefreshToken(raw);
      await pool.query(
        'DELETE FROM auth_refresh_tokens WHERE token_hash = $1',
        [hash],
      );
    }
    reply.clearCookie(config.SESSION_COOKIE_NAME, { path: '/' });
    reply.clearCookie(config.REFRESH_COOKIE_NAME, { path: '/auth' });
    return { ok: true };
  });
}
