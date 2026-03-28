# Releasing

This project publishes Linux AppImage builds through GitHub Actions when a `v*` tag is pushed.

## Release checklist
1. Update the package version:

```bash
npm version patch --no-git-tag-version
```

2. Verify the project locally:

```bash
npm test
npm run dist:linux
```

3. Commit the release changes.
4. Create an annotated tag:

```bash
git tag -a vX.Y.Z -m "Release vX.Y.Z"
```

5. Push `main` and the tag:

```bash
git push origin main
git push origin vX.Y.Z
```

6. Confirm the release workflow in [release.yml](../.github/workflows/release.yml) succeeds and uploads:
- `Unofficial.WAN.Client-X.Y.Z.AppImage`
- `sha256sums.txt`

## Notes
- The workflow handles the GitHub Release upload automatically.
- Local packaging uses `--publish never` so the build itself does not try to publish artifacts.
- If a tag build fails before upload, fix the issue, push the fix, and publish a new version tag instead of mutating a release after the fact.
