import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";

export function startServer(app: Hono, opts: { port: number; webDir: string }): { close: () => void } {
  // Static assets + SPA fallback for non-/api routes.
  app.use("/*", serveStatic({ root: opts.webDir }));
  app.get("/*", serveStatic({ path: `${opts.webDir}/index.html` }));
  const server = serve({ fetch: app.fetch, port: opts.port });
  return { close: () => server.close() };
}
