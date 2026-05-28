export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  groupId: string;
  redirectUri: string;
  sessionSecret: string;
  groupsClaim: string;
  scopes: string;
  sessionTtlHours: number;
}

type Env = Record<string, string | undefined>;

const REQUIRED: ReadonlyArray<readonly [string, keyof OidcConfig]> = [
  ["STET_OIDC_ISSUER", "issuer"],
  ["STET_OIDC_CLIENT_ID", "clientId"],
  ["STET_OIDC_CLIENT_SECRET", "clientSecret"],
  ["STET_OIDC_GROUP_ID", "groupId"],
  ["STET_OIDC_REDIRECT_URI", "redirectUri"],
  ["STET_SESSION_SECRET", "sessionSecret"],
];

function parseTtlHours(raw: string | undefined): number {
  if (!raw) return 168;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 168;
}

export function parseOidcConfig(env: Env): OidcConfig | null {
  const requested = Object.keys(env).some((k) => k.startsWith("STET_OIDC_") && !!env[k]);
  if (!requested) return null;

  const missing = REQUIRED.filter(([k]) => !env[k]).map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(`OIDC is configured but missing required env vars: ${missing.join(", ")}`);
  }

  return {
    issuer: env.STET_OIDC_ISSUER!,
    clientId: env.STET_OIDC_CLIENT_ID!,
    clientSecret: env.STET_OIDC_CLIENT_SECRET!,
    groupId: env.STET_OIDC_GROUP_ID!,
    redirectUri: env.STET_OIDC_REDIRECT_URI!,
    sessionSecret: env.STET_SESSION_SECRET!,
    groupsClaim: env.STET_OIDC_GROUPS_CLAIM || "groups",
    scopes: env.STET_OIDC_SCOPES || "openid profile email groups",
    sessionTtlHours: parseTtlHours(env.STET_SESSION_TTL_HOURS),
  };
}
