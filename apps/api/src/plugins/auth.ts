import { FastifyRequest, FastifyReply } from 'fastify';
import { jwtVerify } from 'jose';
import { config } from '../config.js';

const secret = new TextEncoder().encode(config.JWT_SECRET);

export interface AuthClaims {
  sub: string;
  tenant_id: string;
  role: string;
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[config.SESSION_COOKIE_NAME];
  if (!token) return reply.code(401).send({ error: 'unauthenticated' });
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    (req as unknown as { auth: AuthClaims }).auth = {
      sub: payload.sub as string,
      tenant_id: payload.tenant_id as string,
      role: payload.role as string,
    };
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    const code = name === 'JWTExpired' ? 'token_expired' : 'invalid_token';
    return reply.code(401).send({ error: code });
  }
}

export async function requireTenant(req: FastifyRequest, reply: FastifyReply) {
  const auth = (req as unknown as { auth?: AuthClaims }).auth;
  if (!auth?.tenant_id) return reply.code(403).send({ error: 'tenant_required' });
}
