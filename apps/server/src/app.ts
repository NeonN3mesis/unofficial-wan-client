import path from "node:path";
import { timingSafeEqual } from "node:crypto";
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
    requestAuthToken?: string;
  } = {}
) {
  const app = express();
  app.disable("x-powered-by");
  const requestAuthToken = options.requestAuthToken?.trim() || undefined;

  function hasValidDesktopToken(candidate?: string): boolean {
    if (!requestAuthToken || !candidate) {
      return false;
    }

    const left = Buffer.from(candidate);
    const right = Buffer.from(requestAuthToken);

    return left.length === right.length && timingSafeEqual(left, right);
  }

  app.use(
    helmet({
      contentSecurityPolicy: false
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use((request, response, next) => {
    if (!requestAuthToken) {
      next();
      return;
    }

    if (!request.path.startsWith("/session") && !request.path.startsWith("/wan")) {
      next();
      return;
    }

    if (!hasValidDesktopToken(request.get("x-desktop-token") ?? undefined)) {
      response.status(403).json({
        message: "Desktop API authentication required."
      });
      return;
    }

    next();
  });
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
