## What changes

<!-- One or two sentences. -->

## Checks

- [ ] `npm test`, `npm run check` and `npm run example` pass
- [ ] A change to a check, a project kind, the move order or a reader is described in docs/method.md, and has a test with the files written inline
- [ ] Text from the input goes through `safeText`, and no config value reaches a report; the tool still runs no MSBuild, `dotnet` or NuGet, fetches nothing, opens no connection and reads no file outside the scanned folder
- [ ] Paths are resolved with `path.resolve`, read with either separator and compared ignoring case where Windows does, so the result is the same on Linux, macOS and Windows
- [ ] No real solution, project or config file and no real connection string, key or token in fixtures or examples
- [ ] The commit messages of this pull request follow Conventional Commits
