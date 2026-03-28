import { Router } from "express";
import type { SessionBootstrapRequest } from "../../../../packages/shared/src/index.js";
import type { FloatplaneAdapter } from "../services/floatplane-adapter.js";
import type { ManagedBrowserAuthService } from "../services/managed-browser-auth.js";

export function createSessionRouter(
  adapter: FloatplaneAdapter,
  authService?: ManagedBrowserAuthService
): Router {
  const router = Router();

  router.get("/state", async (_request, response, next) => {
    try {
      const authState = authService?.getSessionState();

      if (authState) {
        response.json(authState);
        return;
      }

      const session = await adapter.getSessionState();
      response.json(session);
    } catch (error) {
      next(error);
    }
  });

  router.post("/bootstrap", async (request, response, next) => {
    try {
      const payload = (request.body ?? {}) as SessionBootstrapRequest;
      const session = await adapter.bootstrapSession(payload);
      response.json(session);
    } catch (error) {
      next(error);
    }
  });

  router.post("/connect/start", async (_request, response, next) => {
    try {
      if (!authService) {
        response.status(501).json({
          status: "error",
          mode: "playwright",
          upstreamMode: "fixture",
          hasPersistedSession: false,
          cookieCount: 0,
          loginUrl: "https://www.floatplane.com/login",
          message: "Managed sign-in is not available in this runtime.",
          nextAction: "retry-connect"
        });
        return;
      }

      const session = await authService.start();
      response.json(session);
    } catch (error) {
      next(error);
    }
  });

  router.post("/connect/complete", async (_request, response, next) => {
    try {
      if (!authService) {
        response.status(501).json({
          message: "Managed sign-in is not available in this runtime."
        });
        return;
      }

      const storageState = await authService.complete();
      const session = await adapter.bootstrapSession({
        mode: "storage-state",
        storageState
      });
      response.json(session);
    } catch (error) {
      next(error);
    }
  });

  router.post("/connect/cancel", async (_request, response, next) => {
    try {
      await authService?.cancel();
      const session = authService?.getSessionState() ?? (await adapter.getSessionState());
      response.json(session);
    } catch (error) {
      next(error);
    }
  });

  router.post("/logout", async (_request, response, next) => {
    try {
      await authService?.cancel();
      const session = await adapter.logout();
      response.json(session);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
