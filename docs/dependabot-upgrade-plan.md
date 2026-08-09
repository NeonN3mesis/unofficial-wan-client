# Dependabot Upgrade Plan

Last updated: 2026-07-10

## Baseline

- GitHub Dependabot alerts: `9` open alerts on 2026-06-20.
- Local `npm audit`: `10` vulnerabilities on 2026-06-20.
  - The extra local advisory is transitive `tmp@0.2.5` via `electron-builder -> app-builder-lib -> @malept/flatpak-bundler -> tmp-promise -> tmp`.
- GitHub PR `#13`: closed, not merged.
  - Title: `Bump esbuild, @vitejs/plugin-react, tsx, vite and vitest`
  - URL: `https://github.com/NeonN3mesis/unofficial-wan-client/pull/13`
  - Base/head: `main` <- `dependabot/npm_and_yarn/multi-497609c6fc`
- Local runtime baseline:
  - Node: `22.x`
  - npm: `10.x`

## Branch Status

- The security-first patch sweep in this branch reduces local `npm audit` findings from `10` to `0`.
- Local packaging is now aligned with the repo baseline:
  - CI already runs on Node `22`
  - the repo now declares Node `22+` explicitly
  - `npm run dist:linux` falls back to a temporary Node `22` runtime when launched from an older local Node version
- Remaining follow-up is mostly on the default branch:
  - re-check GitHub Dependabot after the branch is merged, since GitHub alerts are evaluated on `main`

## What This Means

- There is an active dependency security backlog.
- The repo is still behind on several packages.
- The old Dependabot PR `#13` should not be merged blindly because it jumps the frontend toolchain across major versions.
- The old local Node `18.19.1` packaging failure is no longer a blocker for the current security-first patch sweep.
- The Vite 8 / plugin-react 6 path is still a toolchain project, not a casual dependency bump.

## Current Open GitHub Alerts

Direct alerts:

- `vitest` `critical` -> patch to `3.2.6`
- `vite` `high` -> patch to `6.4.3`
- `vite` `medium` -> patch to `6.4.3`

Transitive alerts:

- `shell-quote` `critical` -> patch to `1.8.4`
- `form-data` `high` -> patch to `4.0.6`
- `tar` `medium` -> patch to `7.5.16`
- `js-yaml` `medium` -> patch to `4.2.0`
- `@babel/core` `low` -> patch to `7.29.6`
- `esbuild` `low` -> patch to `0.28.1`

Local `npm audit` also reports:

- `tmp` `high` -> patch to `0.2.6`

## Immediate Remediation Order

### 0. Security-first patch sweep

These are the highest-signal fixes and should happen before any broader upgrade project:

1. `vitest` `3.2.4 -> 3.2.6`
2. `vite` `6.4.2 -> 6.4.3`
3. `concurrently` `9.2.1 -> 9.2.3`
   - confirmed to pull `shell-quote@1.8.4`
4. `electron-builder` `26.8.1 -> 26.15.3`
   - likely clears part of the `tar` / `js-yaml` / `tmp` transitive backlog
5. `tsx` `4.21.0 -> 4.22.4`
6. Re-run `npm audit` and inspect remaining transitive packages.

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
- `npm audit`
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

1. Land the immediate security-first patch sweep.
2. Re-run `npm audit` and GitHub Dependabot to measure what remains.
3. Land the rest of bucket 1 patch/minor updates.
4. Keep Node 22 as the repo baseline across local workflow and CI.
5. Recreate `#13` as a fresh branch instead of trying to reuse the closed PR.
6. Validate the full desktop + server + web stack.
7. Open separate issues/branches for Express 5 and React 19 later.

## Proposed Work Items

### Issue A: patch/minor maintenance sweep

Scope:

- immediate security-first patch sweep
- remaining bucket 1 updates

Definition of done:

- lockfile refreshed
- `npm audit` reduced and documented
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

1. clear the direct and easy transitive security fixes now
2. raise the Node baseline
3. recreate the old Dependabot toolchain jump as a fresh, test-heavy branch
