import type { Context } from "hono";
import { getSignedCookie, setSignedCookie, deleteCookie } from "hono/cookie";

const SESSION_COOKIE = "stet_session";
const TX_COOKIE = "stet_oidc_tx";

export interface SessionData { sub: string; exp: number }
export interface TxData { state: string; nonce: string; codeVerifier: string }

export interface CookieOpts { secret: string; secure: boolean; ttlHours?: number }

export function isAuthorized(groups: unknown, groupId: string): boolean {
  return Array.isArray(groups) && groups.some((g) => String(g) === groupId);
}

export async function setSession(c: Context, opts: CookieOpts, data: SessionData): Promise<void> {
  await setSignedCookie(c, SESSION_COOKIE, JSON.stringify(data), opts.secret, {
    httpOnly: true, sameSite: "Lax", secure: opts.secure, path: "/", maxAge: (opts.ttlHours ?? 168) * 3600,
  });
}

export async function readSession(c: Context, secret: string): Promise<SessionData | null> {
  const raw = await getSignedCookie(c, secret, SESSION_COOKIE);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as SessionData;
    if (typeof data.sub !== "string" || typeof data.exp !== "number") return null;
    if (data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

export function clearSession(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export async function setTx(c: Context, opts: CookieOpts, data: TxData): Promise<void> {
  await setSignedCookie(c, TX_COOKIE, JSON.stringify(data), opts.secret, {
    httpOnly: true, sameSite: "Lax", secure: opts.secure, path: "/", maxAge: 600,
  });
}

export async function takeTx(c: Context, secret: string): Promise<TxData | null> {
  const raw = await getSignedCookie(c, secret, TX_COOKIE);
  deleteCookie(c, TX_COOKIE, { path: "/" });
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as TxData;
    if (!d.state || !d.nonce || !d.codeVerifier) return null;
    return d;
  } catch {
    return null;
  }
}
