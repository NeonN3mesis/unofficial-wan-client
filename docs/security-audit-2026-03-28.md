# Security Audit - 2026-03-28

## Executive summary

This was a static security review of the public codebase for Unofficial WAN Client as of 2026-03-28. The audit focused on the Electron shell, the local Express backend, the managed browser sign-in flow, local data handling, and the playback/chat paths.

Summary:
- No critical or high-severity issues were identified in the current public code review.
- SEC-001 was remediated on 2026-03-28 by adding a per-launch desktop request token enforced by the local backend and supplied through the Electron bridge in [apps/server/src/app.ts:39](../apps/server/src/app.ts#L39), [apps/desktop/src/main.ts:351](../apps/desktop/src/main.ts#L351), [apps/desktop/src/preload.ts:11](../apps/desktop/src/preload.ts#L11), and [apps/web/src/lib/api.ts:18](../apps/web/src/lib/api.ts#L18).
- SEC-002 was remediated on 2026-03-28 by allocating a per-session loopback debugging port for the managed browser in [apps/server/src/services/browser-runtime.ts:70](../apps/server/src/services/browser-runtime.ts#L70) and [apps/server/src/services/managed-browser-auth.ts:271](../apps/server/src/services/managed-browser-auth.ts#L271).
- The codebase already has several strong controls in place:
  - packaged desktop runtime binds the server to `127.0.0.1` on an ephemeral port in [apps/desktop/src/main.ts:348](../apps/desktop/src/main.ts#L348) and [apps/desktop/src/main.ts:369](../apps/desktop/src/main.ts#L369)
  - session and settings files are written with `0o600` permissions in [apps/server/src/services/session-store.ts:31](../apps/server/src/services/session-store.ts#L31), [apps/server/src/services/managed-browser-auth.ts:217](../apps/server/src/services/managed-browser-auth.ts#L217), and [apps/desktop/src/store.ts:34](../apps/desktop/src/store.ts#L34)
  - playback proxying uses opaque local IDs instead of raw `?target=` passthrough URLs in [apps/server/src/routes/wan.ts:165](../apps/server/src/routes/wan.ts#L165), [apps/server/src/routes/wan.ts:200](../apps/server/src/routes/wan.ts#L200), and [apps/server/src/services/playback-registry.ts:17](../apps/server/src/services/playback-registry.ts#L17)
  - `npm audit --json` reported `0` known vulnerabilities at audit time
  - `git ls-files apps/server/data` returned no tracked runtime capture/session artifacts
- The most important remaining work is now Electron renderer hardening and CSP.

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
- Status: Remediated on 2026-03-28 in [apps/server/src/app.ts:39](../apps/server/src/app.ts#L39) through [apps/server/src/app.ts:58](../apps/server/src/app.ts#L58), [apps/desktop/src/main.ts:351](../apps/desktop/src/main.ts#L351) through [apps/desktop/src/main.ts:377](../apps/desktop/src/main.ts#L377), [apps/desktop/src/preload.ts:11](../apps/desktop/src/preload.ts#L11), and [apps/web/src/lib/api.ts:18](../apps/web/src/lib/api.ts#L18) through [apps/web/src/lib/api.ts:36](../apps/web/src/lib/api.ts#L36).
- Location:
  - [apps/server/src/app.ts:24](../apps/server/src/app.ts#L24)
  - [apps/server/src/routes/session.ts:28](../apps/server/src/routes/session.ts#L28)
  - [apps/server/src/routes/session.ts:38](../apps/server/src/routes/session.ts#L38)
  - [apps/server/src/routes/session.ts:91](../apps/server/src/routes/session.ts#L91)
  - [apps/server/src/routes/wan.ts:77](../apps/server/src/routes/wan.ts#L77)
  - [apps/server/src/routes/wan.ts:126](../apps/server/src/routes/wan.ts#L126)
- Evidence:
  - The app installs JSON parsing and mounts `/session` and `/wan` routes, but there is no request authentication, nonce, or origin-validation middleware in [apps/server/src/app.ts:24](../apps/server/src/app.ts#L24) through [apps/server/src/app.ts:26](../apps/server/src/app.ts#L26).
  - State-changing endpoints such as `/session/bootstrap`, `/connect/start`, `/connect/complete`, `/connect/cancel`, `/logout`, and `/wan/chat/send` accept requests without verifying request provenance in [apps/server/src/routes/session.ts:28](../apps/server/src/routes/session.ts#L28) through [apps/server/src/routes/session.ts:95](../apps/server/src/routes/session.ts#L95) and [apps/server/src/routes/wan.ts:126](../apps/server/src/routes/wan.ts#L126) through [apps/server/src/routes/wan.ts:150](../apps/server/src/routes/wan.ts#L150).
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
  - [apps/server/src/config.ts:24](../apps/server/src/config.ts#L24)
  - [apps/server/src/services/browser-runtime.ts:65](../apps/server/src/services/browser-runtime.ts#L65)
  - [apps/server/src/services/browser-runtime.ts:89](../apps/server/src/services/browser-runtime.ts#L89)
- Evidence:
  - The managed sign-in browser exposes Chrome DevTools Protocol on a predictable fixed localhost port, defaulting to `9222`, in [apps/server/src/config.ts:24](../apps/server/src/config.ts#L24).
  - The browser is launched with `--remote-debugging-port=${serverConfig.captureDebugPort}` in [apps/server/src/services/browser-runtime.ts:95](../apps/server/src/services/browser-runtime.ts#L95).
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
- Location:
  - [apps/desktop/src/main.ts:158](../apps/desktop/src/main.ts#L158)
  - [apps/desktop/src/main.ts:166](../apps/desktop/src/main.ts#L166)
  - [apps/web/src/components/ChatMessageBody.tsx:40](../apps/web/src/components/ChatMessageBody.tsx#L40)
- Evidence:
  - The main `BrowserWindow` enables `contextIsolation: true` and `nodeIntegration: false`, but it does not enable `sandbox: true` in [apps/desktop/src/main.ts:166](../apps/desktop/src/main.ts#L166) through [apps/desktop/src/main.ts:170](../apps/desktop/src/main.ts#L170).
  - The renderer emits external chat links with `target="_blank"` in [apps/web/src/components/ChatMessageBody.tsx:40](../apps/web/src/components/ChatMessageBody.tsx#L40) through [apps/web/src/components/ChatMessageBody.tsx:45](../apps/web/src/components/ChatMessageBody.tsx#L45).
  - No `setWindowOpenHandler`, `will-navigate`, or `shell.openExternal` policy is visible in [apps/desktop/src/main.ts](../apps/desktop/src/main.ts).
- Impact:
  - Untrusted external pages can be opened inside the Electron app surface instead of being forced out to the system browser, and the renderer is not sandboxed. That increases the blast radius of any renderer compromise or Electron-specific bug.
- Fix:
  - Enable `sandbox: true` for the main window unless a proven compatibility blocker exists.
  - Add `webContents.setWindowOpenHandler` and `will-navigate` guards so only the local app origin is allowed in-app and external URLs are opened with `shell.openExternal`.
- Mitigation:
  - `contextIsolation: true` and `nodeIntegration: false` are already strong partial defenses.
- False positive notes:
  - If Electron version-specific defaults or packaging constraints require sandbox to remain off, that decision should be documented explicitly.

### Low

#### SEC-004
- Rule ID: EXPRESS-HEADERS-001 / REACT baseline CSP
- Severity: Low
- Location:
  - [apps/server/src/app.ts:19](../apps/server/src/app.ts#L19)
  - [apps/web/index.html:3](../apps/web/index.html#L3)
- Evidence:
  - Helmet is installed, but `contentSecurityPolicy` is explicitly disabled in [apps/server/src/app.ts:20](../apps/server/src/app.ts#L20) through [apps/server/src/app.ts:22](../apps/server/src/app.ts#L22).
  - No CSP meta tag is present in [apps/web/index.html:3](../apps/web/index.html#L3) through [apps/web/index.html:10](../apps/web/index.html#L10).
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

- The desktop runtime moves state out of the repo tree and into Electron user data by default in [apps/desktop/src/main.ts:348](../apps/desktop/src/main.ts#L348) through [apps/desktop/src/main.ts:355](../apps/desktop/src/main.ts#L355).
- Sensitive JSON artifacts are written with restrictive file permissions in [apps/server/src/services/managed-browser-auth.ts:217](../apps/server/src/services/managed-browser-auth.ts#L217) through [apps/server/src/services/managed-browser-auth.ts:220](../apps/server/src/services/managed-browser-auth.ts#L220).
- Session persistence also uses restrictive file permissions in [apps/server/src/services/session-store.ts:31](../apps/server/src/services/session-store.ts#L31) through [apps/server/src/services/session-store.ts:34](../apps/server/src/services/session-store.ts#L34).
- The packaged desktop server binds to loopback and uses a random port in [apps/desktop/src/main.ts:369](../apps/desktop/src/main.ts#L369) through [apps/desktop/src/main.ts:371](../apps/desktop/src/main.ts#L371).
- Playback proxying no longer accepts arbitrary target URLs from the client. Local playback IDs are registered server-side in [apps/server/src/services/playback-registry.ts:17](../apps/server/src/services/playback-registry.ts#L17) through [apps/server/src/services/playback-registry.ts:38](../apps/server/src/services/playback-registry.ts#L38).

## Recommended next steps

1. Lock down Electron external navigation and enable renderer sandboxing.
2. Add a CSP once the local asset and media requirements are fully enumerated.
