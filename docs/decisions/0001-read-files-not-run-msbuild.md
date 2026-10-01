# 1. Read the files, do not run MSBuild

## Context

The tool needs to know, for every project of a .NET Framework solution, its style, its target frameworks, its packages and references, and what it holds that a move to modern .NET has to deal with. There are richer ways to get that: load the solution with MSBuild and evaluate every project, run `dotnet list package` or `nuget restore`, run the .NET Upgrade Assistant, or open the solution in Visual Studio. Each of them means running MSBuild on the solution, with its imports, its targets, its inline tasks and the build scripts of its packages, and most of them need the right .NET Framework targeting packs, the right Visual Studio version, Windows, and access to the package feeds, sometimes with credentials. A solution under study is often old, half-documented and from someone else; running its build is running its code. And the people planning a move need the inventory before anything is set up to build the solution at all: on a laptop, in a review of a codebase, or in a pipeline on Linux.

## Decision

The tool reads the solution file, the project files, `packages.config`, `web.config` and `app.config` as data, and counts the other files by name, and nothing else. It never runs MSBuild, `dotnet`, NuGet or any other program, never evaluates a property, never follows an import, never restores a package and never fetches anything. XML is read by a small reader inside the tool that refuses DOCTYPE and entity declarations. Everything it reports is a fact written in those files, or a count of files, and the rules that turn these facts into findings, project kinds and a move order are written down in docs/method.md.

## Consequences

The inventory runs in a second, on Windows, Linux or macOS, with only Node, no .NET SDK, no network access and no credentials, and no input can make it run code or reach out to a host. The same files always give the same report, so it can run on every pull request of a solution that is being moved. The cost is that it knows only what is written: properties that MSBuild works out from other properties, imports such as `Directory.Build.props` and conditions are not evaluated, and the code inside the projects is not looked at, so it cannot say which APIs a project calls. The README and docs/limits.md say so, and point to the .NET Upgrade Assistant and the API analyzers as the next step once the inventory has shown where to look.
