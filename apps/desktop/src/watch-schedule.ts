import type { BackgroundWatchSettings } from "../../../packages/shared/src/index.js";

export interface ScheduleEvaluation {
  active: boolean;
  activeWindowKey: string | null;
  currentWindowStartAt: Date | null;
  currentWindowEndAt: Date | null;
  nextWindowStartAt: Date;
}

function parseTimeToMinutes(localTime: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(localTime.trim());

  if (!match) {
    return 0;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return 0;
  }

  return hours * 60 + minutes;
}

function atLocalTime(baseDate: Date, localMinutes: number): Date {
  return new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate(),
    Math.floor(localMinutes / 60),
    localMinutes % 60,
    0,
    0
  );
}

function startOfLocalDay(baseDate: Date): Date {
  return new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 0, 0, 0, 0);
}

function addDays(baseDate: Date, days: number): Date {
  return new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate() + days,
    baseDate.getHours(),
    baseDate.getMinutes(),
    baseDate.getSeconds(),
    baseDate.getMilliseconds()
  );
}

function formatWindowKey(baseDate: Date, localMinutes: number): string {
  const year = baseDate.getFullYear().toString().padStart(4, "0");
  const month = `${baseDate.getMonth() + 1}`.padStart(2, "0");
  const day = `${baseDate.getDate()}`.padStart(2, "0");
  const hours = `${Math.floor(localMinutes / 60)}`.padStart(2, "0");
  const minutes = `${localMinutes % 60}`.padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function evaluateWeeklyWindow(
  now: Date,
  weeklyWindow: BackgroundWatchSettings["weeklyWindow"]
): ScheduleEvaluation {
  const startMinutes = parseTimeToMinutes(weeklyWindow.startLocalTime);
  const endMinutes = parseTimeToMinutes(weeklyWindow.endLocalTime);
  const wrapsPastMidnight = endMinutes <= startMinutes;
  const todayStart = startOfLocalDay(now);
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const targetDay = weeklyWindow.dayOfWeek;
  const nextDay = (targetDay + 1) % 7;

  const activeSameDay = now.getDay() === targetDay && currentMinutes >= startMinutes;
  const activeWrappedDay = wrapsPastMidnight && now.getDay() === nextDay && currentMinutes < endMinutes;
  const activePlainDay =
    !wrapsPastMidnight && now.getDay() === targetDay && currentMinutes >= startMinutes && currentMinutes < endMinutes;
  const active = wrapsPastMidnight ? activeSameDay || activeWrappedDay : activePlainDay;

  let currentWindowStartAt: Date | null = null;
  let currentWindowEndAt: Date | null = null;

  if (active) {
    const startDayBase =
      activeWrappedDay && now.getDay() === nextDay ? addDays(todayStart, -1) : todayStart;
    currentWindowStartAt = atLocalTime(startDayBase, startMinutes);
    currentWindowEndAt = wrapsPastMidnight
      ? atLocalTime(addDays(startDayBase, 1), endMinutes)
      : atLocalTime(startDayBase, endMinutes);
  }

  let nextWindowStartAt: Date | null = null;

  for (let offset = 0; offset <= 8; offset += 1) {
    const candidateDay = addDays(todayStart, offset);

    if (candidateDay.getDay() !== targetDay) {
      continue;
    }

    const candidateStart = atLocalTime(candidateDay, startMinutes);

    if (candidateStart > now) {
      nextWindowStartAt = candidateStart;
      break;
    }
  }

  if (!nextWindowStartAt) {
    nextWindowStartAt = atLocalTime(addDays(todayStart, 7), startMinutes);
  }

  return {
    active,
    activeWindowKey:
      active && currentWindowStartAt ? formatWindowKey(currentWindowStartAt, startMinutes) : null,
    currentWindowStartAt,
    currentWindowEndAt,
    nextWindowStartAt
  };
}
