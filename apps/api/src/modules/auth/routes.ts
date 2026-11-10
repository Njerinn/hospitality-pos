import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import { pool } from '../../db/pool.js';
import { config } from '../../config.js';

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const secret = new TextEncoder().encode(config.JWT_SECRET);

interface UserRow {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string;
  role: string;
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

    const token = await new SignJWT({
      sub: user.id,
      tenant_id: user.tenant_id,
      role: user.role,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);

    reply.setCookie(config.SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: config.NODE_ENV !== 'development',
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60,
    });
    return { ok: true };
  });

  app.post('/logout', async (_req, reply) => {
    reply.clearCookie(config.SESSION_COOKIE_NAME, {
      path: '/',
      sameSite: 'strict',
      secure: config.NODE_ENV !== 'development',
    });
    return { ok: true };
  });
}
