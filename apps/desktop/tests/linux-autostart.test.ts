import { describe, expect, it } from "vitest";
import { buildDesktopExecCommand, quoteDesktopExecArg } from "../src/linux-autostart.js";

describe("linux autostart", () => {
  it("quotes desktop Exec paths with spaces and escapes embedded quotes", () => {
    expect(quoteDesktopExecArg("/home/scott/My Apps/Unofficial WAN Client.AppImage")).toBe(
      "\"/home/scott/My Apps/Unofficial WAN Client.AppImage\""
    );
    expect(quoteDesktopExecArg("/tmp/a\"b\\c")).toBe("\"/tmp/a\\\"b\\\\c\"");
  });

  it("builds a valid desktop Exec command from multiple arguments", () => {
    expect(
      buildDesktopExecCommand([
        "/usr/bin/env",
        "ELECTRON_DISABLE_SANDBOX=1",
        "/home/scott/WAN show Floatplane client/node_modules/electron/dist/electron",
        "--no-sandbox",
        "/home/scott/WAN show Floatplane client/apps/desktop/dist/apps/desktop/src/main.js",
        "--background"
      ])
    ).toBe(
      "\"/usr/bin/env\" \"ELECTRON_DISABLE_SANDBOX=1\" \"/home/scott/WAN show Floatplane client/node_modules/electron/dist/electron\" \"--no-sandbox\" \"/home/scott/WAN show Floatplane client/apps/desktop/dist/apps/desktop/src/main.js\" \"--background\""
    );
  });
});
