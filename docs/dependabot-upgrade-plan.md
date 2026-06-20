# Dependabot Upgrade Plan

Last updated: 2026-06-19

## Baseline

- GitHub Dependabot alerts: `0` open alerts at plan time.
- GitHub PR `#13`: closed, not merged.
  - Title: `Bump esbuild, @vitejs/plugin-react, tsx, vite and vitest`
  - URL: `https://github.com/NeonN3mesis/unofficial-wan-client/pull/13`
  - Base/head: `main` <- `dependabot/npm_and_yarn/multi-497609c6fc`
- Local runtime baseline:
  - Node: `18.19.1`
  - npm: `9.2.0`

## What This Means

- There is no active Dependabot security fire right now.
- The repo is still behind on several packages.
- The old Dependabot PR `#13` should not be merged blindly because it jumps the frontend toolchain across major versions.
- Node `18.19.1` is the main blocker for the Vite 8 / plugin-react 6 path. That work should be treated as a toolchain project, not a casual dependency bump.

## Current Upgrade Buckets

### 1. Low-risk patch/minor updates inside current major lines

These should be handled first because they have the best risk/reward ratio:

- `electron` `40.10.1 -> 40.10.2`
- `electron-builder` `26.8.1 -> 26.15.3`
- `helmet` `8.1.0 -> 8.2.0`
- `hls.js` `1.6.15 -> 1.6.16`
- `amazon-ivs-player` `1.50.0 -> 1.53.0`
- `playwright-core` `1.59.1 -> 1.61.0`
- `tsx` `4.21.0 -> 4.22.4`
- `vite` `6.4.2 -> 6.4.3`
- `vitest` `3.2.4 -> 3.2.6`
- `concurrently` `9.2.1 -> 9.2.3`
- `@types/node` `22.19.15 -> 22.19.21`
- `@types/react` `18.3.28 -> 18.3.31`

Expected risk:

- Low.
- Most of these are compatible with the current app architecture and current Node version.

Validation for this bucket:

- `npm install`
- `npm run build`
- `npm test`
- Launch Electron from repo build and verify:
  - session bootstrap
  - live probe
  - stream playback
  - chat send/read
  - tray/background launch

### 2. Recreate the closed `#13` toolchain jump in a dedicated branch

This work should be done only after bucket 1 is green.

Likely package set:

- `esbuild`
- `vite` `6.x -> 8.x`
- `@vitejs/plugin-react` `4.x -> 6.x`
- `vitest` `3.x -> 4.x`
- related transitive lockfile movement

Why this is a separate project:

- `apps/web/vite.config.ts` uses `@vitejs/plugin-react`, so this is core build tooling.
- `@vitejs/plugin-react` 6 removed Babel-related behavior. This repo currently calls `react()` with no custom Babel config, which is good, but it still needs a full smoke test.
- Vite 8 is likely to require a newer Node runtime than the current local `18.19.1`.

Prerequisites before starting this bucket:

- Move local and CI Node to a supported version for Vite 8.
- Confirm Electron build, Vite dev server, and Vitest still run under that Node version.

Planned checks for this bucket:

- `npm run dev:web`
- `npm run build:web`
- `npm run test`
- `npm run dev:desktop`
- verify no regressions in:
  - HLS/IVS player loading
  - proxying `/session` and `/wan`
  - React render startup
  - test runner behavior

Exit criteria:

- frontend build passes
- tests pass
- desktop app launches from built output
- no dev-server regressions

### 3. Deferred major-version upgrades not driven by a current alert

These should not be mixed into the Dependabot security/toolchain branch:

- `express` `4.x -> 5.x`
- `react` `18.x -> 19.x`
- `react-dom` `18.x -> 19.x`
- `typescript` `5.x -> 6.x`
- `@types/react-dom` `18.x -> 19.x`
- `@types/supertest` `6.x -> 7.x`
- `concurrently` `9.x -> 10.x`

Why defer them:

- `express` 5 can change router/middleware behavior and error handling.
- React 19 is a framework migration, not a maintenance bump.
- TypeScript 6 can change type-checking enough to create noisy unrelated work.

## Recommended Execution Order

1. Land bucket 1 patch/minor updates.
2. Update Node baseline in local workflow and CI.
3. Recreate `#13` as a fresh branch instead of trying to reuse the closed PR.
4. Validate the full desktop + server + web stack.
5. Open separate issues/branches for Express 5 and React 19 later.

## Proposed Work Items

### Issue A: patch/minor maintenance sweep

Scope:

- all bucket 1 updates

Definition of done:

- lockfile refreshed
- build/test green
- desktop smoke test complete

### Issue B: recreate Dependabot toolchain branch

Scope:

- modernize Vite/plugin-react/vitest/esbuild stack
- raise Node baseline as needed

Definition of done:

- branch replaces the intent of closed PR `#13`
- local/CI Node version documented
- build/dev/test paths verified

### Issue C: deferred framework majors

Scope:

- `express@5`
- `react@19`
- `typescript@6`

Definition of done:

- each major handled independently with its own regression testing

## Recommendation

Do not treat this as a single mega-upgrade.

The correct move is:

1. take the low-risk patch/minor updates now
2. raise the Node baseline
3. recreate the old Dependabot toolchain jump as a fresh, test-heavy branch

