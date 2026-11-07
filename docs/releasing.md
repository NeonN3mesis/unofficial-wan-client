# Releasing

This project publishes Linux AppImage builds through GitHub Actions when the package version changes on `main`. Pushing a matching `v*` tag also runs the release workflow.

## Release checklist
1. Update the package version:

```bash
nvm use
npm version patch --no-git-tag-version
```

2. Verify the project locally:

```bash
npm test
npm run dist:linux
```

3. Merge the version bump to `main`. The release workflow creates the matching tag and publishes the release.
4. Confirm the release workflow in [release.yml](../.github/workflows/release.yml) succeeds and uploads:
- `Unofficial.WAN.Client-X.Y.Z.AppImage`
- `sha256sums.txt`

## Notes
- The workflow creates the tag and handles the GitHub Release upload automatically.
- Local packaging uses `--publish never` so the build itself does not try to publish artifacts.
- Use Node 22 locally for release work. CI and release packaging already run on Node 22.
- If a release build fails before upload, fix the issue and publish a new version instead of mutating a release after the fact.
