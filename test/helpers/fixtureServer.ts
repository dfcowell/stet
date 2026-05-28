import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

export interface FixtureRoute {
  body?: string;
  status?: number;
  headers?: Record<string, string>;
  contentType?: string;
}

export interface FixtureServer {
  url: string;
  close: () => Promise<void>;
}

export function startFixtureServer(
  routes: Record<string, FixtureRoute>,
): Promise<FixtureServer> {
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0]!;
    const route = routes[path];
    if (!route) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    res.statusCode = route.status ?? 200;
    res.setHeader("content-type", route.contentType ?? "text/html; charset=utf-8");
    for (const [k, v] of Object.entries(route.headers ?? {})) res.setHeader(k, v);
    res.end(route.body ?? "");
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}
