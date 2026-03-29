import { describe, expect, it } from "vitest";
import { classifyNavigationTarget } from "../src/navigation-policy.js";

describe("desktop navigation policy", () => {
  const appOrigin = "http://127.0.0.1:4123";

  it("keeps same-origin navigation inside the app", () => {
    expect(classifyNavigationTarget("/wan", appOrigin)).toBe("app");
    expect(classifyNavigationTarget("http://127.0.0.1:4123/session/state", appOrigin)).toBe(
      "app"
    );
  });

  it("forces web links out to the system browser", () => {
    expect(classifyNavigationTarget("https://www.floatplane.com", appOrigin)).toBe("external");
    expect(classifyNavigationTarget("mailto:test@example.com", appOrigin)).toBe("external");
  });

  it("denies unsupported or dangerous schemes", () => {
    expect(classifyNavigationTarget("javascript:alert(1)", appOrigin)).toBe("deny");
    expect(classifyNavigationTarget("file:///tmp/test.html", appOrigin)).toBe("deny");
    expect(classifyNavigationTarget("http://[::1", appOrigin)).toBe("deny");
  });
});
