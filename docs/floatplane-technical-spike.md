# Floatplane Technical Spike

## Visual Direction
- Visual thesis: build the client like a restrained live control room, with one dominant video plane, a high-signal chat rail, and warm broadcast accents cutting through a cold technical surface.
- Content plan: primary workspace first, then operational notes.
- Interaction thesis: animate the ambient background subtly, pulse the live indicator, and let chat items rise into place so state changes feel present without turning the UI into a dashboard toy.

## Confirmed Public Signals
- `https://www.floatplane.com/` serves the production SPA and loads its user bundle from `https://frontend.floatplane.com/user/4.5.2-208-1c15cf6/js/index-B1ikcMW8.js`.
- The public bundle exposes `isLiveStreamEnabled`, external login flags, route definitions such as `/history`, `/browse`, and `/tv`, and a persisted chat key shaped like `fp:chat:settings`.
- `https://www.floatplane.com/api` currently responds with a JSON 404 and an `fp-instance: floatplane-api-main-...` header, which strongly suggests a real API tier behind the same public domain.
- `https://status.floatplane.com/` confirms Floatplane actively tracks playback and live-service incidents.

## Minimum Reverse-Engineering Targets
1. Authenticated session bootstrap
   Goal: capture which cookies and local-storage values are sufficient to make the live-state, playback, and chat requests from a non-browser client.
   Expected artifacts: cookie names, expiration behavior, any CSRF tokens, and whether requests require additional client headers.
2. WAN Show live-state lookup
   Goal: identify the request that resolves the current live asset, stream status, and any creator or channel metadata needed for routing.
   Expected artifacts: endpoint path, required query params, and status handling for offline or scheduled states.
3. Playback source acquisition
   Goal: identify the request that returns the real HLS or DASH manifest for the active WAN Show stream.
   Expected artifacts: endpoint path, response shape, DRM flags, and whether the manifest URL is signed or short-lived.
4. Live chat join and send
   Goal: capture how the official client reads the chat stream and what request shape is required to post a message.
   Expected artifacts: transport type, reconnect semantics, rate-limit behavior, payload schema, and auth failure responses.

## Current Adapter Mapping
- The local BFF is live and stable, but it is running in fixture mode.
- `POST /session/bootstrap` supports a safe local stand-in session by default and accepts Playwright-style `storageState` JSON for real browser-session reuse.
- `GET /wan/live` still falls back to `apps/server/src/fixtures/upstream-live.fixture.ts`, but captured sessions now let the server probe real creator and delivery metadata directly with the saved Floatplane cookies.
- `GET /wan/chat/stream` relays fixture SSE messages by default, but captured sessions now promote it to a managed headless relay sourced from the real Floatplane chat websocket.
- `POST /wan/chat/send` still uses local echo in fixture mode, but captured sessions now submit through the official Floatplane chat composer in a managed headless Chromium runtime and wait for the upstream websocket echo.
- If `apps/server/data/floatplane-storage-state.json` exists, the adapter now auto-loads it and boots into captured-session mode.
- If `apps/server/data/floatplane-capture-summary.json` exists, the adapter now prefers the captured playback manifest and enables the managed chat relay.
- If `apps/server/data/floatplane-api-probes.json` exists, the adapter now prefers the probed `creatorNamed` live stream metadata and stream path over the fixture title and fixture playback URL.

## Gaps Before Real Floatplane Wiring
- No captured upstream request paths are checked into the repo yet.
- No HAR, cookie map, or signed playback manifest examples are present.
- The chat send route is now identified and exercised through the official browser UI, but its ack/error permutations still need broader capture coverage.
- Probe refresh still benefits from a real browser session that already passed Cloudflare, even though the runtime live probe now works directly from the saved cookies.

## Capture Procedure
1. Run `npm run capture:floatplane`.
2. Complete Cloudflare verification in the opened Chrome session if needed.
3. Log in to Floatplane if needed.
4. Navigate to the WAN Show live page and let playback plus chat load.
5. Press Enter in the terminal to save the storage state, network log, and summary into `apps/server/data/`.
6. Restart the app or hit bootstrap again so the BFF picks up the captured artifacts.
7. Capture more upstream send outcomes such as rate-limit, auth-expired, and rejected-message cases so the managed relay can map them more precisely.

If Cloudflare blocks the spawned browser session, start Chrome manually with `--remote-debugging-port=9222` and rerun the capture using `FLOATPLANE_CAPTURE_ATTACH_URL=http://127.0.0.1:9222 npm run capture:floatplane`.
