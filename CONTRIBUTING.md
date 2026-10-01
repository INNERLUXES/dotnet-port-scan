# Contributing

Every change goes through a pull request and is reviewed before it is merged. The pipeline runs the tests on Linux, Windows and macOS, the repository checks, CodeQL, and a secure development check of the repository itself.

Commit messages in this repository follow Conventional Commits: `feat:`, `fix:`, `docs:`, `test:`, `ci:`, with `!` for a breaking change.

## Changing a check

1. Describe the change in docs/method.md first: what the check reports, its severity, and why it matters for a move to modern .NET, with the part of Microsoft's porting overview, the ASP.NET to ASP.NET Core migration guide, the .NET support policy or CoreWCF it follows. Where the tool makes its own choice (how a project kind is guessed, which group a kind belongs to in the move order, which assemblies count as Windows-only), say so and say why.
2. Add a test with the solution, project and config files written inline, small enough that the result can be worked out by hand. Use made-up project, package and host names.
3. Text from the input goes through `safeText` before it reaches a finding or a note, so control characters are removed. Never put a value from a config file (a connection string, a key, an address) into a finding.
4. A finding id, once released, keeps its meaning: pipelines and other tools read it from the JSON and CSV reports.

## Changing the readers

1. For the XML reader, add a test for every form you add and one that must be refused. Keep refusing DOCTYPE and ENTITY declarations and every entity except the five XML predefines; a form that cannot be read with certainty is refused, never guessed.
2. For the solution and project readers, write the test input the way Visual Studio writes it, with Windows backslash paths, and make sure the result is the same on Linux and macOS: resolve with `path.resolve`, never `path.join`, when a value may be absolute, and compare paths ignoring case where Windows does.
3. Every path from an input is resolved and checked against the scanned folder before it is opened, and links are checked after they are followed.
4. Keep every pattern anchored and free of nested repetition, and keep the size, count and depth limits.

## Rules for the code

- No runtime dependencies. Node 22 or newer and nothing else.
- The tool reads files inside the folder it is given and writes only to the screen. It opens no network connection, runs no program (no MSBuild, no `dotnet`, no NuGet, no shell), and never follows a URL from an input.
- Source files stay ASCII; write any other character in a pattern as a `\u` escape.
- Never commit a real solution, project or config file, even as a fixture. Write small made-up files, and never put a real connection string, key or token into one, even an expired one.

## Before you open the pull request

```
npm test
npm run check
npm run example
```
