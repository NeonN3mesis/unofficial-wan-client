import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import express from "express";
import helmet from "helmet";
import type { FloatplaneAdapter } from "./services/floatplane-adapter.js";
import { createSessionRouter } from "./routes/session.js";
import { createWanRouter } from "./routes/wan.js";
import type { ManagedBrowserAuthService } from "./services/managed-browser-auth.js";

const appContentSecurityPolicy = {
  useDefaults: false,
  directives: {
    defaultSrc: ["'self'"],
    baseUri: ["'none'"],
    connectSrc: ["'self'"],
    fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
    imgSrc: ["'self'", "data:", "https:"],
    mediaSrc: ["'self'", "blob:"],
    objectSrc: ["'none'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    workerSrc: ["'self'", "blob:"]
  }
} as const;

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
      contentSecurityPolicy: appContentSecurityPolicy
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
