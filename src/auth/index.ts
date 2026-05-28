import type { Hono, MiddlewareHandler } from "hono";
import type { OidcConfig } from "./config.js";
import type { OidcClient } from "./oidc.js";
import { isAuthorized, readSession, setSession, clearSession, setTx, takeTx } from "./session.js";

export interface Auth {
  middleware: MiddlewareHandler;
  registerRoutes(app: Hono): void;
}

export function createAuth(config: OidcConfig, oidc: OidcClient): Auth {
  const secure = new URL(config.redirectUri).protocol === "https:";
  const cookieOpts = { secret: config.sessionSecret, secure };

  const middleware: MiddlewareHandler = async (c, next) => {
    if (c.req.path.startsWith("/auth/")) return next();
    const session = await readSession(c, config.sessionSecret);
    if (session) return next();
    if ((c.req.header("accept") ?? "").includes("text/html")) return c.redirect("/auth/login");
    return c.json({ error: "unauthenticated" }, 401);
  };

  function registerRoutes(app: Hono): void {
    app.get("/auth/login", async (c) => {
      const req = await oidc.createLoginRequest();
      await setTx(c, cookieOpts, { state: req.state, nonce: req.nonce, codeVerifier: req.codeVerifier });
      return c.redirect(req.url);
    });

    app.get("/auth/callback", async (c) => {
      const tx = await takeTx(c, config.sessionSecret);
      if (!tx) return c.text("Login expired or invalid. Please try again.", 400);

      // Build the callback URL from the configured redirect_uri + the incoming
      // query so it is correct behind a TLS-terminating proxy.
      const callbackUrl = new URL(config.redirectUri);
      callbackUrl.search = new URL(c.req.url).search;

      let claims: Record<string, unknown>;
      try {
        ({ claims } = await oidc.exchange(callbackUrl.href, tx));
      } catch {
        return c.text("Authentication failed.", 400);
      }

      if (!isAuthorized(claims[config.groupsClaim], config.groupId)) {
        return c.text("Access denied: you are not a member of the required group.", 403);
      }

      const exp = Date.now() + config.sessionTtlHours * 3600 * 1000;
      await setSession(c, { ...cookieOpts, ttlHours: config.sessionTtlHours }, { sub: String(claims.sub ?? ""), exp });
      return c.redirect("/");
    });

    app.get("/auth/logout", (c) => {
      clearSession(c);
      return c.redirect("/");
    });
  }

  return { middleware, registerRoutes };
}
