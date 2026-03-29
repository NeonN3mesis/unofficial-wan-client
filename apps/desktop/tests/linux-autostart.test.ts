import { describe, expect, it } from "vitest";
import { quoteDesktopExecArg } from "../src/linux-autostart.js";

describe("linux autostart", () => {
  it("quotes desktop Exec paths with spaces and escapes embedded quotes", () => {
    expect(quoteDesktopExecArg("/home/scott/My Apps/Unofficial WAN Client.AppImage")).toBe(
      "\"/home/scott/My Apps/Unofficial WAN Client.AppImage\""
    );
    expect(quoteDesktopExecArg("/tmp/a\"b\\c")).toBe("\"/tmp/a\\\"b\\\\c\"");
  });
});
