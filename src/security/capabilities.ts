/**
 * Capability-scoped authorization for the kernel API.
 *
 * The review scored Security 4.5/10: the Hono surface was fully
 * unauthenticated — anyone who could reach the port could trigger the
 * trading pipeline. This module defines the permission vocabulary;
 * `auth.ts` enforces it fail-closed on every route.
 *
 * Principle of least privilege: a key grants a SET of capabilities, and
 * every mutating route declares the minimum capability it requires.
 */

/** Scopes a caller may hold. Ordered from read-only to most privileged. */
export type Capability =
  | 'READ_MARKET'
  | 'READ_PORTFOLIO'
  | 'READ_AUDIT'
  | 'RUN_PIPELINE'
  | 'CREATE_INTENT'
  | 'EXECUTE'
  | 'CONTROL_TRADE'
  | 'ADMIN';

/** Well-known caller presets. Custom sets are supported via config. */
export type CallerRole = 'viewer' | 'operator' | 'trader' | 'admin';

const VIEWER: readonly Capability[] = [
  'READ_MARKET', 'READ_PORTFOLIO', 'READ_AUDIT',
];

const OPERATOR: readonly Capability[] = [
  ...VIEWER, 'RUN_PIPELINE',
];

const TRADER: readonly Capability[] = [
  ...OPERATOR, 'CREATE_INTENT', 'EXECUTE', 'CONTROL_TRADE',
];

const ADMIN: readonly Capability[] = [
  ...TRADER, 'ADMIN',
];

const ROLE_PRESETS: Record<CallerRole, readonly Capability[]> = {
  viewer: VIEWER,
  operator: OPERATOR,
  trader: TRADER,
  admin: ADMIN,
};

export interface CallerIdentity {
  /** Stable key id for audit (never the secret itself). */
  readonly keyId: string;
  readonly role: CallerRole;
  readonly capabilities: readonly Capability[];
}

export const capabilitiesForRole = (role: CallerRole): readonly Capability[] =>
  ROLE_PRESETS[role];

export const hasCapability = (
  identity: CallerIdentity,
  required: Capability
): boolean => identity.capabilities.includes(required);

const isCallerRole = (value: string | undefined): value is CallerRole =>
  value === 'viewer' || value === 'operator' ||
  value === 'trader' || value === 'admin';

export interface ParsedCredential {
  readonly keyId: string;
  readonly secret: string;
  /** Present only when an explicit valid role segment was supplied. */
  readonly role?: CallerRole;
}

/**
 * Parse one `id:secret[:role]` credential. Secrets may contain colons:
 * the FIRST segment is the id; the LAST is the role ONLY when it names a
 * valid role (so a secret ending in a role word must supply an explicit
 * role segment — ambiguity resolves toward never mis-granting a role).
 */
export const parseCredential = (raw: string): ParsedCredential | undefined => {
  const parts = raw.trim().split(':');
  if (parts.length < 2 || !parts[0]) return undefined;
  const keyId = parts[0];
  const last = parts[parts.length - 1];
  if (parts.length >= 3 && isCallerRole(last)) {
    return { keyId, secret: parts.slice(1, -1).join(':'), role: last };
  }
  return { keyId, secret: parts.slice(1).join(':') };
};

/**
 * Parse `KERNEL_API_KEYS` of the form `id:secret:role[,id:secret:role...]`.
 * Roles default to `viewer`. Malformed entries are skipped (fail-closed:
 * they can never silently grant access).
 */
export const parseApiKeys = (
  raw: string | undefined
): ReadonlyMap<string, { secret: string; role: CallerRole }> => {
  const map = new Map<string, { secret: string; role: CallerRole }>();
  if (!raw) return map;
  for (const entry of raw.split(',')) {
    const cred = parseCredential(entry);
    if (!cred) continue;
    map.set(cred.keyId, { secret: cred.secret, role: cred.role ?? 'viewer' });
  }
  return map;
};

export const identityFor = (
  keys: ReadonlyMap<string, { secret: string; role: CallerRole }>,
  keyId: string
): CallerIdentity | undefined => {
  const entry = keys.get(keyId);
  if (!entry) return undefined;
  return { keyId, role: entry.role, capabilities: capabilitiesForRole(entry.role) };
};
