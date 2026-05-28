import * as client from "openid-client";
import type { OidcConfig } from "./config.js";

export interface LoginRequest {
  url: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

export interface OidcClient {
  createLoginRequest(): Promise<LoginRequest>;
  exchange(currentUrl: string, tx: { codeVerifier: string; state: string; nonce: string }): Promise<{ claims: Record<string, unknown> }>;
}

export async function createOidcClient(config: OidcConfig): Promise<OidcClient> {
  const oidcConfig = await client.discovery(new URL(config.issuer), config.clientId, config.clientSecret);

  return {
    async createLoginRequest(): Promise<LoginRequest> {
      const codeVerifier = client.randomPKCECodeVerifier();
      const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
      const state = client.randomState();
      const nonce = client.randomNonce();
      const url = client.buildAuthorizationUrl(oidcConfig, {
        redirect_uri: config.redirectUri,
        scope: config.scopes,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        state,
        nonce,
      }).href;
      return { url, state, nonce, codeVerifier };
    },

    async exchange(currentUrl, tx): Promise<{ claims: Record<string, unknown> }> {
      const tokens = await client.authorizationCodeGrant(oidcConfig, new URL(currentUrl), {
        pkceCodeVerifier: tx.codeVerifier,
        expectedState: tx.state,
        expectedNonce: tx.nonce,
      });
      return { claims: (tokens.claims() ?? {}) as Record<string, unknown> };
    },
  };
}
