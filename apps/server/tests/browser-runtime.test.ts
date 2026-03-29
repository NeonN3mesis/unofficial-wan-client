import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { buildDebugEndpoint, reserveLoopbackPort } from "../src/services/browser-runtime.js";

describe("browser runtime", () => {
  it("reserves a loopback port that can be reused for a managed browser session", async () => {
    const port = await reserveLoopbackPort();

    expect(port).toBeGreaterThan(0);
    expect(buildDebugEndpoint(port)).toBe(`http://127.0.0.1:${port}`);

    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => resolve());
    });
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  });
});
