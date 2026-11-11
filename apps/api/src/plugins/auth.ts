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
  if ((req as unknown as { auth?: AuthClaims }).auth) return;
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


export type Role = 'admin' | 'manager' | 'cashier' | 'waiter' | 'kitchen';

export function requireAuthAndRole(...allowed: Role[]) {
  return async function roleGuard(req: FastifyRequest, reply: FastifyReply) {
    let auth = (req as unknown as { auth?: AuthClaims }).auth;

    if (!auth) {
      const token = req.cookies[config.SESSION_COOKIE_NAME];
      if (!token) return reply.code(401).send({ error: 'unauthenticated' });
      try {
        const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
        auth = {
          sub: payload.sub as string,
          tenant_id: payload.tenant_id as string,
          role: payload.role as string,
        };
        (req as unknown as { auth: AuthClaims }).auth = auth;
      } catch (err) {
        const name = err instanceof Error ? err.name : '';
        const code = name === 'JWTExpired' ? 'token_expired' : 'invalid_token';
        return reply.code(401).send({ error: code });
      }
    }

    if (!auth.tenant_id) {
      return reply.code(403).send({ error: 'tenant_required' });
    }
    if (!allowed.includes(auth.role as Role)) {
      return reply.code(403).send({
        error: 'forbidden',
        required_roles: allowed,
        actual_role: auth.role,
      });
    }
  };
}