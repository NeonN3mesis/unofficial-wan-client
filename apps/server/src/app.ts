import path from "node:path";
import express from "express";
import helmet from "helmet";
import type { FloatplaneAdapter } from "./services/floatplane-adapter.js";
import { createSessionRouter } from "./routes/session.js";
import { createWanRouter } from "./routes/wan.js";
import type { ManagedBrowserAuthService } from "./services/managed-browser-auth.js";

export function createApp(
  adapter: FloatplaneAdapter,
  options: {
    authService?: ManagedBrowserAuthService;
    webDistDir?: string;
  } = {}
) {
  const app = express();
  app.disable("x-powered-by");

  app.use(
    helmet({
      contentSecurityPolicy: false
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use("/session", createSessionRouter(adapter, options.authService));
  app.use("/wan", createWanRouter(adapter));

  if (options.webDistDir) {
    app.use(express.static(options.webDistDir));
    app.get("*", (request, response, next) => {
      if (request.path.startsWith("/session") || request.path.startsWith("/wan")) {
        next();
        return;
      }

      response.sendFile(path.join(options.webDistDir!, "index.html"));
    });
  }

  app.use((_request, response) => {
    response.status(404).json({ message: "Not found" });
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    console.error(error);
    response.status(500).json({
      message:
        process.env.NODE_ENV === "production"
          ? "Internal server error"
          : error instanceof Error
            ? error.message
            : "Unknown server error"
    });
  });

  return app;
}
