import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "./app.js";
import { serverConfig } from "./config.js";
import { FixtureFloatplaneAdapter } from "./services/floatplane-adapter.js";
import { ManagedBrowserAuthService } from "./services/managed-browser-auth.js";
import { SessionStore } from "./services/session-store.js";

export interface StartedServer {
  app: ReturnType<typeof createApp>;
  server: Server;
  host: string;
  port: number;
  adapter: FixtureFloatplaneAdapter;
  authService: ManagedBrowserAuthService;
  close: () => Promise<void>;
}

export async function startServer(
  options: {
    host?: string;
    port?: number;
    webDistDir?: string;
    allowFixtureBootstrap?: boolean;
  } = {}
): Promise<StartedServer> {
  const sessionStore = new SessionStore(serverConfig.sessionFilePath, serverConfig.sessionTtlMs);
  const adapter = new FixtureFloatplaneAdapter(sessionStore, {
    allowFixtureBootstrap: options.allowFixtureBootstrap ?? serverConfig.allowFixtureBootstrap
  });
  const authService = new ManagedBrowserAuthService();
  const app = createApp(adapter, {
    authService,
    webDistDir: options.webDistDir ?? serverConfig.webDistDir
  });
  const host = options.host ?? serverConfig.host;
  const port = options.port ?? serverConfig.port;
  const server = await new Promise<Server>((resolve) => {
    const nextServer = app.listen(port, host, () => resolve(nextServer));
  });
  const address = server.address() as AddressInfo | null;

  return {
    app,
    server,
    host,
    port: address?.port ?? port,
    adapter,
    authService,
    close: async () => {
      await authService.dispose();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  };
}
