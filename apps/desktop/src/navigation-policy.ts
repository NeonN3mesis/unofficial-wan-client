export type NavigationTargetDisposition = "app" | "external" | "deny";

const EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function classifyNavigationTarget(
  targetUrl: string,
  appOrigin: string
): NavigationTargetDisposition {
  let parsedTarget: URL;

  try {
    parsedTarget = new URL(targetUrl, appOrigin);
  } catch {
    return "deny";
  }

  if (parsedTarget.origin === appOrigin) {
    return "app";
  }

  return EXTERNAL_PROTOCOLS.has(parsedTarget.protocol) ? "external" : "deny";
}
