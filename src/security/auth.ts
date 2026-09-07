import type { Context, Next } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import type { Capability, CallerIdentity } from './capabilities.js';
import { hasCapability, identityFor, parseApiKeys, parseCredential } from './capabilities.js';

/** Hono app variables set by the auth middleware. */
export interface AuthVariables {
  readonly Variables: { caller: CallerIdentity };
}

type AuthContext = Context<AuthVariables>;

/**
 * Fail-closed authentication + capability authorization for the Hono
 * surface. Requests authenticate with `Authorization: Bearer <keyId>:<secret>`
 * (or `X-Kernel-Key: <keyId>:<secret>`). Secret comparison is timing-safe.
 *
 * When no keys are configured the middleware denies EVERYTHING except the
 * explicitly-marked public routes — an unauthenticated trading API is the
 * vulnerability class the review called out, so "no config" means "no
 * access", never "open access".
 */
export class ApiAuthenticator {
  private readonly keys = parseApiKeys(process.env.KERNEL_API_KEYS);

  get configured(): boolean {
    return this.keys.size > 0;
  }

  /** Constant-time secret check; never throws on length mismatch. */
  private secretMatches(expected: string, provided: string): boolean {
    const a = Buffer.from(expected, 'utf-8');
    const b = Buffer.from(provided, 'utf-8');
    if (a.length !== b.length || a.length === 0) return false;
    return timingSafeEqual(a, b);
  }

  /** Extract `keyId:secret[:role]`, verify, and return the caller identity. */
  authenticate(header: string | undefined): CallerIdentity | undefined {
    if (!header) return undefined;
    const cred = parseCredential(header.trim().replace(/^Bearer\s+/i, ''));
    if (!cred || !cred.keyId || !cred.secret) return undefined;
    const entry = this.keys.get(cred.keyId);
    if (!entry || !this.secretMatches(entry.secret, cred.secret)) return undefined;
    return identityFor(this.keys, cred.keyId);
  }

  /** Hono middleware: 401 on bad/missing credentials, 403 on missing scope. */
  middleware(required: Capability) {
    return async (c: AuthContext, next: Next): Promise<Response | void> => {
      const header = c.req.header('authorization') ?? c.req.header('x-kernel-key');
      const identity = this.authenticate(header);
      if (!identity) {
        return c.json({ error: 'unauthorized' }, 401);
      }
      if (!hasCapability(identity, required)) {
        return c.json(
          { error: 'forbidden', required, role: identity.role },
          403
        );
      }
      c.set('caller', identity);
      await next();
      return;
    };
  }
}

/** Audit record for privileged calls (who triggered what). */
export const auditCaller = (
  store: { append: (e: { type: string; payload: unknown }) => unknown },
  identity: CallerIdentity,
  action: string,
  detail: Record<string, unknown> = {}
): void => {
  store.append({
    type: 'api.call',
    payload: { keyId: identity.keyId, role: identity.role, action, ...detail },
  });
};
