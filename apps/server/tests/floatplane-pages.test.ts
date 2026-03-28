import { describe, expect, it } from "vitest";
import {
  findPreferredFloatplanePage,
  isSameFloatplanePageUrl
} from "../src/services/floatplane-pages.js";

describe("floatplane page selection", () => {
  it("matches Floatplane pages by origin and pathname", () => {
    expect(
      isSameFloatplanePageUrl(
        "https://www.floatplane.com/live/linustechtips?foo=1",
        "https://www.floatplane.com/live/linustechtips"
      )
    ).toBe(true);
    expect(
      isSameFloatplanePageUrl(
        "https://www.floatplane.com/live/linustechtips",
        "https://www.floatplane.com/creator/linustechtips/home"
      )
    ).toBe(false);
  });

  it("prefers an existing WAN live page before any generic Floatplane page", () => {
    const pages = [
      {
        url: () => "https://www.floatplane.com/creator/linustechtips/home"
      },
      {
        url: () => "https://www.floatplane.com/live/linustechtips?from=relay"
      }
    ];
    const context = {
      pages: () => pages
    } as {
      pages: () => Array<{ url: () => string }>;
    };

    const selected = findPreferredFloatplanePage(
      context as never,
      "https://www.floatplane.com/live/linustechtips"
    );

    expect(selected).toBe(pages[1]);
  });
});
