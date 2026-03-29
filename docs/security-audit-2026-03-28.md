# Security Audit - 2026-03-28

## Executive summary

This was a static security review of the public codebase for Unofficial WAN Client as of 2026-03-28. The audit focused on the Electron shell, the local Express backend, the managed browser sign-in flow, local data handling, and the playback/chat paths.

Summary:
- No critical or high-severity issues were identified in the current public code review.
- SEC-001 was remediated on 2026-03-28 by adding a per-launch desktop request token enforced by the local backend and supplied through the Electron bridge in [apps/server/src/app.ts:57](../apps/server/src/app.ts#L57) through [apps/server/src/app.ts:77](../apps/server/src/app.ts#L77), [apps/desktop/src/main.ts:395](../apps/desktop/src/main.ts#L395) through [apps/desktop/src/main.ts:423](../apps/desktop/src/main.ts#L423), [apps/desktop/src/main.ts:502](../apps/desktop/src/main.ts#L502) through [apps/desktop/src/main.ts:504](../apps/desktop/src/main.ts#L504), [apps/desktop/src/preload.ts:11](../apps/desktop/src/preload.ts#L11), and [apps/web/src/lib/api.ts:18](../apps/web/src/lib/api.ts#L18).
- SEC-002 was remediated on 2026-03-28 by allocating a per-session loopback debugging port for the managed browser in [apps/server/src/services/browser-runtime.ts:70](../apps/server/src/services/browser-runtime.ts#L70) and [apps/server/src/services/managed-browser-auth.ts:271](../apps/server/src/services/managed-browser-auth.ts#L271).
- SEC-003 was remediated on 2026-03-28 by enabling renderer sandboxing and adding explicit in-app navigation and external-link guards in [apps/desktop/src/main.ts:177](../apps/desktop/src/main.ts#L177) through [apps/desktop/src/main.ts:237](../apps/desktop/src/main.ts#L237) and [apps/desktop/src/navigation-policy.ts:5](../apps/desktop/src/navigation-policy.ts#L5) through [apps/desktop/src/navigation-policy.ts:21](../apps/desktop/src/navigation-policy.ts#L21).
- SEC-004 was remediated on 2026-03-28 by replacing the disabled Helmet CSP with a restrictive policy tailored to the renderer's actual asset needs in [apps/server/src/app.ts:10](../apps/server/src/app.ts#L10) through [apps/server/src/app.ts:55](../apps/server/src/app.ts#L55).
- The codebase already has several strong controls in place:
  - packaged desktop runtime binds the server to `127.0.0.1` on an ephemeral port in [apps/desktop/src/main.ts:417](../apps/desktop/src/main.ts#L417) through [apps/desktop/src/main.ts:419](../apps/desktop/src/main.ts#L419)
  - session and settings files are written with `0o600` permissions in [apps/server/src/services/session-store.ts:31](../apps/server/src/services/session-store.ts#L31), [apps/server/src/services/managed-browser-auth.ts:217](../apps/server/src/services/managed-browser-auth.ts#L217), and [apps/desktop/src/store.ts:34](../apps/desktop/src/store.ts#L34)
  - playback proxying uses opaque local IDs instead of raw `?target=` passthrough URLs in [apps/server/src/routes/wan.ts:165](../apps/server/src/routes/wan.ts#L165), [apps/server/src/routes/wan.ts:200](../apps/server/src/routes/wan.ts#L200), and [apps/server/src/services/playback-registry.ts:17](../apps/server/src/services/playback-registry.ts#L17)
  - packaged Electron windows now run with `sandbox: true` and deny unexpected navigation in [apps/desktop/src/main.ts:177](../apps/desktop/src/main.ts#L177) through [apps/desktop/src/main.ts:237](../apps/desktop/src/main.ts#L237)
  - the local app server now emits a restrictive CSP for bundled UI responses in [apps/server/src/app.ts:10](../apps/server/src/app.ts#L10) through [apps/server/src/app.ts:55](../apps/server/src/app.ts#L55)
  - `npm audit --json` reported `0` known vulnerabilities at audit time
  - `git ls-files apps/server/data` returned no tracked runtime capture/session artifacts
- All findings from this review are remediated in the current codebase. Remaining work is normal maintenance: keep the CSP aligned with new renderer capabilities and keep core dependencies current.

## Scope and method

Reviewed areas:
- Electron shell and preload bridge
- Express bootstrap, session routes, WAN routes, and proxy code
- Managed browser sign-in and local storage of session/capture artifacts
- React renderer entrypoints and chat link rendering
- dependency hygiene via `npm audit --json`

This report is intentionally public-safe. It does not include exploit walkthroughs or sensitive runtime data.

## Findings

### Medium

#### SEC-001
- Rule ID: EXPRESS-INPUT-001 / local control-plane trust boundary
- Severity: Medium
- Status: Remediated on 2026-03-28 in [apps/server/src/app.ts:57](../apps/server/src/app.ts#L57) through [apps/server/src/app.ts:77](../apps/server/src/app.ts#L77), [apps/desktop/src/main.ts:395](../apps/desktop/src/main.ts#L395) through [apps/desktop/src/main.ts:423](../apps/desktop/src/main.ts#L423), [apps/desktop/src/main.ts:502](../apps/desktop/src/main.ts#L502) through [apps/desktop/src/main.ts:504](../apps/desktop/src/main.ts#L504), [apps/desktop/src/preload.ts:11](../apps/desktop/src/preload.ts#L11), and [apps/web/src/lib/api.ts:18](../apps/web/src/lib/api.ts#L18) through [apps/web/src/lib/api.ts:36](../apps/web/src/lib/api.ts#L36).
- Location:
  - [apps/server/src/app.ts:57](../apps/server/src/app.ts#L57)
  - [apps/desktop/src/main.ts:395](../apps/desktop/src/main.ts#L395)
  - [apps/desktop/src/main.ts:502](../apps/desktop/src/main.ts#L502)
  - [apps/desktop/src/preload.ts:11](../apps/desktop/src/preload.ts#L11)
  - [apps/web/src/lib/api.ts:18](../apps/web/src/lib/api.ts#L18)
- Evidence:
  - The backend now rejects `/session` and `/wan` requests without a matching `x-desktop-token` header in [apps/server/src/app.ts:57](../apps/server/src/app.ts#L57) through [apps/server/src/app.ts:77](../apps/server/src/app.ts#L77).
  - Electron main now generates a random per-launch token and passes it into the loopback server at startup in [apps/desktop/src/main.ts:395](../apps/desktop/src/main.ts#L395) through [apps/desktop/src/main.ts:423](../apps/desktop/src/main.ts#L423).
  - The preload bridge and renderer request helper now attach the token to desktop API requests in [apps/desktop/src/preload.ts:11](../apps/desktop/src/preload.ts#L11), [apps/desktop/src/main.ts:502](../apps/desktop/src/main.ts#L502) through [apps/desktop/src/main.ts:504](../apps/desktop/src/main.ts#L504), and [apps/web/src/lib/api.ts:18](../apps/web/src/lib/api.ts#L18) through [apps/web/src/lib/api.ts:36](../apps/web/src/lib/api.ts#L36).
- Impact:
  - Any local process that can discover the loopback port can drive session lifecycle, chat send, or playback-related requests against the server. A browser-origin attack is harder because the port is ephemeral, but the app still trusts any caller that reaches the port.
- Fix:
  - Add a per-launch secret shared only between Electron main/preload and the backend, for example an `X-Desktop-Token` header checked server-side on every `/session` and `/wan` route.
  - Reject state-changing requests when `Origin` and `Referer` do not match the app's own local origin.
- Mitigation:
  - Keeping the server on `127.0.0.1` with a random port already reduces exposure significantly.
- False positive notes:
  - If an unexposed transport-layer control already exists outside app code, it is not visible here and should be verified explicitly.

#### SEC-002
- Rule ID: local browser automation boundary
- Severity: Medium
- Status: Remediated on 2026-03-28 in [apps/server/src/services/browser-runtime.ts:70](../apps/server/src/services/browser-runtime.ts#L70) through [apps/server/src/services/browser-runtime.ts:117](../apps/server/src/services/browser-runtime.ts#L117), [apps/server/src/services/browser-runtime.ts:140](../apps/server/src/services/browser-runtime.ts#L140) through [apps/server/src/services/browser-runtime.ts:146](../apps/server/src/services/browser-runtime.ts#L146), and [apps/server/src/services/managed-browser-auth.ts:271](../apps/server/src/services/managed-browser-auth.ts#L271) through [apps/server/src/services/managed-browser-auth.ts:275](../apps/server/src/services/managed-browser-auth.ts#L275).
- Location:
  - [apps/server/src/services/browser-runtime.ts:70](../apps/server/src/services/browser-runtime.ts#L70)
  - [apps/server/src/services/browser-runtime.ts:96](../apps/server/src/services/browser-runtime.ts#L96)
  - [apps/server/src/services/browser-runtime.ts:140](../apps/server/src/services/browser-runtime.ts#L140)
  - [apps/server/src/services/managed-browser-auth.ts:271](../apps/server/src/services/managed-browser-auth.ts#L271)
- Evidence:
  - Managed sign-in now reserves an ephemeral loopback debugging port at runtime in [apps/server/src/services/browser-runtime.ts:70](../apps/server/src/services/browser-runtime.ts#L70) through [apps/server/src/services/browser-runtime.ts:94](../apps/server/src/services/browser-runtime.ts#L94).
  - The chosen port is resolved once per session and used to build the debugging endpoint in [apps/server/src/services/browser-runtime.ts:96](../apps/server/src/services/browser-runtime.ts#L96) through [apps/server/src/services/browser-runtime.ts:117](../apps/server/src/services/browser-runtime.ts#L117).
  - The managed browser launch and CDP connection both use that resolved endpoint in [apps/server/src/services/browser-runtime.ts:140](../apps/server/src/services/browser-runtime.ts#L140) through [apps/server/src/services/browser-runtime.ts:146](../apps/server/src/services/browser-runtime.ts#L146) and [apps/server/src/services/managed-browser-auth.ts:271](../apps/server/src/services/managed-browser-auth.ts#L271) through [apps/server/src/services/managed-browser-auth.ts:275](../apps/server/src/services/managed-browser-auth.ts#L275).
- Impact:
  - Another local process can attach to the debugging endpoint during sign-in, inspect the authenticated browser state, and potentially extract cookies or drive privileged browser actions.
- Fix:
  - Use a random ephemeral debug port per launch rather than a predictable static default.
  - Prefer a transport that is not broadly exposed on loopback, such as a pipe/socket supported by the automation stack, if available.
  - Tear down the managed browser immediately after capture, which the code already mostly does.
- Mitigation:
  - The exposure window is limited to the active managed sign-in session.
- False positive notes:
  - This is primarily a local-machine threat. It matters more on multi-user or untrusted local environments than on a single-user hardened desktop.

#### SEC-003
- Rule ID: Electron renderer hardening
- Severity: Medium
- Status: Remediated on 2026-03-28 in [apps/desktop/src/main.ts:177](../apps/desktop/src/main.ts#L177) through [apps/desktop/src/main.ts:237](../apps/desktop/src/main.ts#L237) and [apps/desktop/src/navigation-policy.ts:5](../apps/desktop/src/navigation-policy.ts#L5) through [apps/desktop/src/navigation-policy.ts:21](../apps/desktop/src/navigation-policy.ts#L21).
- Location:
  - [apps/desktop/src/main.ts:177](../apps/desktop/src/main.ts#L177)
  - [apps/desktop/src/main.ts:185](../apps/desktop/src/main.ts#L185)
  - [apps/desktop/src/navigation-policy.ts:5](../apps/desktop/src/navigation-policy.ts#L5)
- Evidence:
  - The main `BrowserWindow` now enables `sandbox: true` and explicitly keeps `webviewTag` disabled in [apps/desktop/src/main.ts:185](../apps/desktop/src/main.ts#L185) through [apps/desktop/src/main.ts:191](../apps/desktop/src/main.ts#L191).
  - Child-window creation is denied and external destinations are handed off to the system browser through `setWindowOpenHandler` plus `shell.openExternal` in [apps/desktop/src/main.ts:196](../apps/desktop/src/main.ts#L196) through [apps/desktop/src/main.ts:204](../apps/desktop/src/main.ts#L204).
  - Top-level navigation is restricted to the local app origin by `will-navigate` and a centralized URL classifier in [apps/desktop/src/main.ts:206](../apps/desktop/src/main.ts#L206) through [apps/desktop/src/main.ts:218](../apps/desktop/src/main.ts#L218) and [apps/desktop/src/navigation-policy.ts:5](../apps/desktop/src/navigation-policy.ts#L5) through [apps/desktop/src/navigation-policy.ts:21](../apps/desktop/src/navigation-policy.ts#L21).
- Impact:
  - Untrusted external pages can be opened inside the Electron app surface instead of being forced out to the system browser, and the renderer is not sandboxed. That increases the blast radius of any renderer compromise or Electron-specific bug.
- Fix:
  - Enable `sandbox: true` for the main window unless a proven compatibility blocker exists.
  - Add `webContents.setWindowOpenHandler` and `will-navigate` guards so only the local app origin is allowed in-app and external URLs are opened with `shell.openExternal`.
- Mitigation:
  - `contextIsolation: true` and `nodeIntegration: false` were already strong partial defenses, and packaged desktop builds now also enforce the navigation policy and request renderer sandboxing.
- False positive notes:
  - Local Linux development scripts still use `--no-sandbox` as a developer convenience workaround for unsuided Electron installs. That does not affect packaged release behavior, but it means dev-mode launches are not a hardened runtime equivalent.

### Low

#### SEC-004
- Rule ID: EXPRESS-HEADERS-001 / REACT baseline CSP
- Severity: Low
- Status: Remediated on 2026-03-28 in [apps/server/src/app.ts:10](../apps/server/src/app.ts#L10) through [apps/server/src/app.ts:55](../apps/server/src/app.ts#L55).
- Location:
  - [apps/server/src/app.ts:10](../apps/server/src/app.ts#L10)
  - [apps/server/src/app.ts:51](../apps/server/src/app.ts#L51)
- Evidence:
  - Helmet now emits a restrictive CSP built around the renderer's actual resource requirements, including same-origin scripts/connect calls, Google Fonts, remote poster images over `https:`, and `blob:` media/worker sources for HLS playback, in [apps/server/src/app.ts:10](../apps/server/src/app.ts#L10) through [apps/server/src/app.ts:25](../apps/server/src/app.ts#L25).
  - The CSP is enforced by default for app responses through [apps/server/src/app.ts:51](../apps/server/src/app.ts#L51) through [apps/server/src/app.ts:55](../apps/server/src/app.ts#L55).
- Impact:
  - If an XSS bug is introduced later, the browser has no CSP safety net to limit script execution or resource loading.
- Fix:
  - Add a restrictive CSP header for the local app origin. Start with `default-src 'self'` and then explicitly allow only the minimal script, connect, media, image, and style sources needed by the app.
- Mitigation:
  - React's escaping-by-default behavior lowers current XSS exposure, and this audit did not identify unsafe HTML injection sinks in the renderer.
- False positive notes:
  - If CSP is set outside the app by packaging or another local server layer, that is not visible here and should be verified at runtime.

## Dependency hygiene

At audit time:
- `npm audit --json` returned zero known vulnerabilities.
- `npm outdated --json` showed several packages behind latest major versions, including Electron, Express, React, Vite, and Vitest. That is not an immediate vulnerability finding, but it should be monitored as part of normal maintenance.

## What looks good

- The desktop runtime moves state out of the repo tree and into Electron user data by default in [apps/desktop/src/main.ts:395](../apps/desktop/src/main.ts#L395) through [apps/desktop/src/main.ts:403](../apps/desktop/src/main.ts#L403).
- Sensitive JSON artifacts are written with restrictive file permissions in [apps/server/src/services/managed-browser-auth.ts:217](../apps/server/src/services/managed-browser-auth.ts#L217) through [apps/server/src/services/managed-browser-auth.ts:220](../apps/server/src/services/managed-browser-auth.ts#L220).
- Session persistence also uses restrictive file permissions in [apps/server/src/services/session-store.ts:31](../apps/server/src/services/session-store.ts#L31) through [apps/server/src/services/session-store.ts:34](../apps/server/src/services/session-store.ts#L34).
- The packaged desktop server binds to loopback and uses a random port in [apps/desktop/src/main.ts:417](../apps/desktop/src/main.ts#L417) through [apps/desktop/src/main.ts:419](../apps/desktop/src/main.ts#L419).
- Playback proxying no longer accepts arbitrary target URLs from the client. Local playback IDs are registered server-side in [apps/server/src/services/playback-registry.ts:17](../apps/server/src/services/playback-registry.ts#L17) through [apps/server/src/services/playback-registry.ts:38](../apps/server/src/services/playback-registry.ts#L38).

## Recommended next steps

1. Re-run the security review when the renderer adds new external resources or new IPC surface area.
2. Keep Electron, Express, React, Vite, and Vitest updated as part of routine maintenance.
