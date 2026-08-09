import { describe, expect, it } from "vitest";
import {
  resolveDesktopLaunchCommand,
  resolveDesktopWebDistDir
} from "../src/runtime-paths.js";

describe("desktop runtime paths", () => {
  it("resolves the bundled web dist directory from the compiled desktop entry", () => {
    const resolved = resolveDesktopWebDistDir(
      "/home/scott/WAN show Floatplane client/apps/desktop/dist/apps/desktop/src"
    );

    expect(resolved).toBe("/home/scott/WAN show Floatplane client/apps/web/dist");
  });

  it("builds a development autostart launch command that points at the current entry script", () => {
    const command = resolveDesktopLaunchCommand({
      argv: [
        "/home/scott/WAN show Floatplane client/node_modules/.bin/electron",
        "apps/desktop/dist/apps/desktop/src/main.js",
        "--no-sandbox"
      ],
      cwd: "/home/scott/WAN show Floatplane client",
      execPath: "/home/scott/WAN show Floatplane client/node_modules/electron/dist/electron",
      isPackaged: false
    });

    expect(command).toEqual({
      args: [
        "/usr/bin/env",
        "ELECTRON_DISABLE_SANDBOX=1",
        "/home/scott/WAN show Floatplane client/node_modules/electron/dist/electron",
        "--no-sandbox",
        "/home/scott/WAN show Floatplane client/apps/desktop/dist/apps/desktop/src/main.js",
        "--background"
      ],
      workingDir: "/home/scott/WAN show Floatplane client"
    });
  });

  it("prefers the AppImage path for packaged autostart launches", () => {
    const command = resolveDesktopLaunchCommand({
      appImage: "/home/scott/Applications/Unofficial.WAN.Client.AppImage",
      argv: ["/home/scott/Applications/Unofficial.WAN.Client.AppImage"],
      cwd: "/tmp",
      execPath: "/tmp/ignored",
      isPackaged: true
    });

    expect(command).toEqual({
      args: ["/home/scott/Applications/Unofficial.WAN.Client.AppImage", "--background"]
    });
  });
});
