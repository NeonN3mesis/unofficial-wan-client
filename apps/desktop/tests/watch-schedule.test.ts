import { describe, expect, it } from "vitest";
import type { BackgroundWatchSettings } from "../../../packages/shared/src/index.js";
import { evaluateWeeklyWindow } from "../src/watch-schedule.js";

const DEFAULT_WINDOW: BackgroundWatchSettings["weeklyWindow"] = {
  dayOfWeek: 5,
  startLocalTime: "19:00",
  endLocalTime: "00:00"
};

describe("watch schedule", () => {
  it("activates inside the default Friday evening window", () => {
    const result = evaluateWeeklyWindow(new Date(2026, 2, 27, 20, 15, 0), DEFAULT_WINDOW);

    expect(result.active).toBe(true);
    expect(result.activeWindowKey).toBe("2026-03-27T19:00");
  });

  it("treats wrapped windows as active after midnight on the following day", () => {
    const result = evaluateWeeklyWindow(new Date(2026, 2, 28, 0, 0, 0), DEFAULT_WINDOW);

    expect(result.active).toBe(false);

    const preMidnight = evaluateWeeklyWindow(new Date(2026, 2, 27, 23, 59, 0), DEFAULT_WINDOW);
    expect(preMidnight.active).toBe(true);
  });

  it("recomputes the next window start cleanly after the Friday window ends", () => {
    const result = evaluateWeeklyWindow(new Date(2026, 2, 28, 9, 30, 0), DEFAULT_WINDOW);

    expect(result.active).toBe(false);
    expect(result.nextWindowStartAt.getDay()).toBe(5);
    expect(result.nextWindowStartAt.getHours()).toBe(19);
    expect(result.nextWindowStartAt.getMinutes()).toBe(0);
  });
});
