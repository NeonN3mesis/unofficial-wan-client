import { describe, expect, it } from "vitest";
import { resolveDesktopWebDistDir } from "../src/runtime-paths.js";

describe("desktop runtime paths", () => {
  it("resolves the bundled web dist directory from the compiled desktop entry", () => {
    const resolved = resolveDesktopWebDistDir(
      "/home/scott/WAN show Floatplane client/apps/desktop/dist/apps/desktop/src"
    );

    expect(resolved).toBe("/home/scott/WAN show Floatplane client/apps/web/dist");
  });
});
