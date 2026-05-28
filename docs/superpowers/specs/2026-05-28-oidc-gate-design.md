# stet — Optional OIDC Access Gate — Design Specification

**Date:** 2026-05-28
**Status:** Approved (brainstorming)

## Summary

Add an **optional** OpenID Connect access gate to stet. When the app is deployed
with OIDC configuration present, all access requires an authenticated user who is
a member of a configured group. When no OIDC configuration is present, the app
behaves exactly as today (single-user, self-hosted, no auth).

This is **just an authentication/authorization gate** — there is no per-user data,
no user-specific libraries, and no other user-scoped functionality at this stage.
The authenticated identity gates access and nothing more.

## Goals

- Gate the entire app behind OIDC when configured, enforcing membership of one
  group.
- Be a no-op when not configured (no behavioral change to the existing app).
- Use a vetted OIDC library and standard, secure flow — no hand-rolled token or
  JWKS validation.
- Fail closed: a partial/misconfigured OIDC setup must never run the app
  unauthenticated.

## Non-Goals

- No per-user libraries, progress, profiles, or any user-scoped data.
- No role/permission model beyond single-group membership.
- No multi-tenant support.
- No provider-side single-logout / session revocation (local session clear only).
- No UserInfo round-trip (groups are read from the ID token, per provider setup).

## Activation (fail-closed)

OIDC is *requested* if **any** `STET_OIDC_*` environment variable is set. If
requested, **all required variables must be present**; otherwise the app **refuses
to boot** with a clear error. This prevents a partial misconfiguration from
silently serving the app wide-open. If no `STET_OIDC_*` variable is set, the gate
is disabled and the app runs exactly as it does today.

## Environment Variables

Required to enable:

| Variable | Purpose |
|----------|---------|
| `STET_OIDC_ISSUER` | OIDC issuer / discovery base URL |
| `STET_OIDC_CLIENT_ID` | OAuth client id |
| `STET_OIDC_CLIENT_SECRET` | OAuth client secret |
| `STET_OIDC_GROUP_ID` | Required group; the user must be a member |
| `STET_OIDC_REDIRECT_URI` | Callback URL, e.g. `https://host/auth/callback` |
| `STET_SESSION_SECRET` | HMAC secret for signing session/transaction cookies |

Optional:

| Variable | Default | Purpose |
|----------|---------|---------|
| `STET_OIDC_GROUPS_CLAIM` | `groups` | ID-token claim holding the group list |
| `STET_OIDC_SCOPES` | `openid profile email groups` | Requested scopes |
| `STET_SESSION_TTL_HOURS` | `168` | Session lifetime (7 days) |

## Architecture

New module `src/auth/`, each file with one clear responsibility:

- **`config.ts`** — `parseOidcConfig(env): OidcConfig | null`. Returns `null` when
  the gate is disabled (no `STET_OIDC_*` vars). Throws a clear error when OIDC is
  requested but required vars are missing. Pure; fully unit-testable.
- **`session.ts`** — session payload helpers and authorization check:
  `isAuthorized(groups: unknown, groupId: string): boolean` (membership test,
  defensive about non-array claims), and sign/verify of the `{ sub, exp }` session
  via Hono's signed cookies. Pure logic is unit-testable; cookie I/O via the Hono
  context.
- **`oidc.ts`** — thin wrapper over `openid-client` v6: `discover(config)` (once at
  startup), `buildLoginUrl({ state, nonce, codeChallenge })`, and
  `exchange(currentUrl, { codeVerifier, state, nonce }) → { claims }`. Isolated so
  the surrounding flow can be tested with this wrapper faked.
- **`index.ts`** — `createAuth(config, oidc)` → `{ middleware, registerRoutes(app) }`.
  Composes the gate middleware and the `/auth/*` routes.

**Wiring:** `createApp` gains an optional `auth` dependency. When present, the gate
middleware is registered before all routes (so it also covers the static assets
added in `serve.ts`), and the `/auth/*` routes are registered. The composition
root (`src/index.ts`) builds the config + oidc + auth (or `null`) from the
environment and passes it in. Discovery runs once at boot; an unreachable issuer
fails fast.

## Auth Flow (Authorization Code + PKCE)

1. **Gate middleware** runs before all routes and bypasses only paths under
   `/auth/`. If a valid session cookie is present → continue. Otherwise:
   - request that accepts `text/html` (a navigation) → `302` to `/auth/login`;
   - any other request (`/api/*`, SSE, assets) → `401`.
2. **`GET /auth/login`** — generate `state`, `nonce`, and a PKCE verifier/challenge;
   store `{ state, nonce, codeVerifier }` in a short-lived (≈10 min) signed
   transaction cookie; `302` to the provider authorization URL
   (`scope`, `code_challenge`, `code_challenge_method=S256`, `state`, `nonce`).
3. **`GET /auth/callback`** — read+clear the transaction cookie; `openid-client`
   validates `state`, `nonce`, and the ID token (signature via JWKS, `iss`/`aud`/
   `exp`). Read the groups claim and check `STET_OIDC_GROUP_ID` membership:
   - member → set the signed session cookie (`{ sub, exp }`, `HttpOnly`,
     `SameSite=Lax`, `Secure`, `Path=/`, `Max-Age`=TTL) and `302` to `/`;
   - not a member → `403` with a clear message.
4. **`GET /auth/logout`** — clear the session cookie and `302` to `/`.

## What Is Gated

When enabled, every route is gated except `/auth/*`. Static assets are only
fetched by the SPA after the page itself loads (which requires a session), so
gating them is invisible in normal use and safe.

## Frontend

Minimal change: when an `/api/*` `fetch` returns `401` (session expired
mid-session), the SPA redirects to `/auth/login`. No other UI changes.

## Error Handling

- **Partial config** → throw at boot (fail closed) with a message listing missing
  vars.
- **Issuer unreachable at boot** → fail fast with a clear error.
- **Invalid/expired session cookie** → treated as unauthenticated (redirect/401).
- **State/nonce mismatch or token validation failure at callback** → `400`, no
  session set.
- **Authenticated but not in group** → `403`, no session set.
- **Expired transaction cookie at callback** → `400` ("login expired, try again").

## Security Considerations

- Authorization Code + PKCE; `state` (CSRF) and `nonce` (replay) enforced by
  `openid-client`.
- Session cookie is **signed** (integrity), `HttpOnly`, `SameSite=Lax`, `Secure`,
  `Path=/`. Payload is non-sensitive (`sub`, `exp`).
- `STET_SESSION_SECRET` has no insecure default; required when OIDC is enabled.
- Fail-closed activation prevents an unauthenticated deployment from a typo.
- Group membership re-evaluated at each login (and at session expiry), not stored
  server-side.

## Testing (no live IdP in CI)

- **config:** disabled when no vars; enabled when all present; throws on partial.
- **session:** `isAuthorized` (member / non-member / non-array claim); sign+verify
  roundtrip; expired and tampered cookies rejected.
- **gate middleware:** disabled → passthrough; enabled + no session → HTML request
  redirects to `/auth/login`, `/api/*` returns `401`; `/auth/*` always allowed;
  valid session → passthrough.
- **callback:** with the `oidc.ts` wrapper faked — in-group claim → session set +
  redirect to `/`; out-of-group → `403`; transaction-cookie/state mismatch → `400`.
- No network or real provider in CI.

## Open Questions / Deferred

- Provider end-session (single logout) integration — deferred.
- Per-user data / multi-user features — explicitly out of scope for this stage.
