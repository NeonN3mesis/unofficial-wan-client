import type { BrowserContext, Page } from "playwright-core";

export function isFloatplaneUrl(url: string): boolean {
  return (
    url.startsWith("https://www.floatplane.com") ||
    url.startsWith("https://beta.floatplane.com") ||
    url.startsWith("https://floatplane.com")
  );
}

export function isSameFloatplanePageUrl(candidateUrl: string, targetUrl: string): boolean {
  try {
    const candidate = new URL(candidateUrl);
    const target = new URL(targetUrl);

    return candidate.origin === target.origin && candidate.pathname === target.pathname;
  } catch {
    return false;
  }
}

export function findPreferredFloatplanePage(
  context: BrowserContext,
  preferredUrl?: string
): Page | undefined {
  const pages = [...context.pages()].reverse();

  if (preferredUrl) {
    const exactMatch = pages.find((page) => isSameFloatplanePageUrl(page.url(), preferredUrl));

    if (exactMatch) {
      return exactMatch;
    }
  }

  return pages.find((page) => isFloatplaneUrl(page.url()));
}
