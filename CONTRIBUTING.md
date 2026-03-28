# Contributing

Thanks for helping improve Unofficial WAN Client.

## Before you start
- Keep the app local-only by default.
- Do not commit real Floatplane session data, browser profiles, HAR files, storage-state files, or probe payloads.
- Prefer focused pull requests over large mixed changes.
- Add or update tests when behavior changes.

## Local setup
```bash
npm install
npm test
npm run build
```

For desktop work, run:

```bash
npm run dev:desktop
```

## Areas where contributions are useful
- Linux desktop runtime behavior
- Floatplane auth and session resilience
- Playback relay stability
- Background auto-watch scheduling
- Documentation and install polish

## Pull request expectations
- Describe the user-visible change clearly.
- Note how the change was tested.
- Include screenshots or short recordings for UI changes when practical.
- Preserve the local-only and loopback-only security model.

## Maintainers
- Release instructions live in [docs/releasing.md](./docs/releasing.md).
