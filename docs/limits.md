# Limits

## A file inventory, not a compiler

- **No look at the code.** The tool reads project files, solution files and config files, and counts source files by kind. It does not read C#, VB.NET or F# code, so it cannot say which APIs the code calls, whether those APIs exist on modern .NET, or whether the project compiles after retargeting. A class library with no `System.Web` reference can still call an API that modern .NET does not have, and a project with a `System.Drawing` reference may use it in one line or in a thousand. For an API-level answer, run Microsoft's .NET Upgrade Assistant and the .NET API analyzers on the projects this inventory points at; they compile the code and know the API surface of each target. The inventory says where to look and in what order; those tools say what to change in the code.
- **No package analysis.** Packages are listed with the versions the files name. The tool does not know whether a package has a version for modern .NET, whether it was replaced by another package, or whether it has known vulnerabilities. Check each package against its own release notes, and use `dotnet list package --vulnerable` or a dependency scanner once the projects restore with `PackageReference`.
- **Kinds are guesses.** The project kind comes from the SDK, project type ids, references, packages and the files in the folder (docs/method.md gives the rules). A Web Forms project that also hosts a few Web API controllers is reported as Web Forms; a class library that holds WCF service implementations hosted elsewhere is reported as a class library. The JSON report has the facts behind each guess.
- **Counts are files, not effort.** Three `.aspx` pages may be three small forms or three screens with hundreds of controls and view state. The counts say where the work is, not how large it is.

## MSBuild is not evaluated

- **Computed and conditional properties.** MSBuild works out properties from other properties, environment variables, imports and conditions. The tool reads values as written: a property set from `$(...)` is not used and is named in a note, and a property set only under a `Condition` is read from the first group that sets it. A `TargetFramework` that depends on the configuration or the platform may therefore be shown differently from what a build uses.
- **Imports.** `Directory.Build.props`, `Directory.Build.targets`, `Directory.Packages.props` (central package management), `.props` and `.targets` files from packages, and other imported files are not read. A target framework, package version or reference set there is not seen; when no target framework is found in an SDK-style project, a note says it may come from `Directory.Build.props`.
- **Items.** Wildcards in item includes are not expanded, `Remove` and `Update` items are not applied, and items inside a `<Target>` are not read. Assembly references with a `HintPath` are listed by name only.
- **Choose and When.** Properties and items inside `<Choose>` blocks are read as if every branch applied.

## Languages and project types

- **C# is covered best.** C# projects (`.csproj`) are read fully. VB.NET (`.vbproj`) and F# (`.fsproj`) project files are read the same way, but only partly covered: VB.NET Web Forms pages and `.vbhtml` views are counted, while settings particular to VB.NET (`My` application framework, `OptionStrict`) and the F# compile order are not looked at.
- **Other project types.** Web site projects (a folder without a project file, listed in the solution by URL or path), database projects (`.sqlproj`), installers, C++ projects (`.vcxproj`) and shared projects (`.shproj`, `.projitems`) are named in a note and not read.
- **New solution format.** XML solution files (`.slnx`) are not read; give the folder instead, and every project file in it is read.

## Config files

- Only `web.config`, `app.config` and `packages.config` in the folder of a project file are read. Configuration transforms (`Web.Release.config`), `configSource` files and machine-wide configuration are not read.
- Only the sections listed in docs/method.md are read. Authentication, session state, custom configuration sections and the `appSettings` and `connectionStrings` sections are not reported: they need attention in a move, but reading them would mean showing values that may be secrets.

## Paths

- Paths are compared ignoring letter case, as on Windows. On Linux or macOS, two files whose names differ only in case are treated as one.
- Links (symbolic links and junctions) to folders are never followed, also when they stay inside the folder, so nothing is counted twice. Links to files inside the folder are read; links that lead outside the folder are never read.
- The folders `bin`, `obj`, `packages`, `node_modules`, `.git` and `.vs` are skipped at any depth. A project that lives inside such a folder is not found.

## Size

- A solution, project or config file over 20 MB is not read. For the `.sln` file given with `--path` the run stops with exit code 2; any other file is reported as `unreadable`.
- More than 5,000 projects, or more than 500,000 files in the folder, stop the run with exit code 2, rather than describing part of the solution: a project left out would be missing from the move order.
- Folders nested more than 64 deep stop the run. A file with XML elements nested more than 64 deep, or with more than 500,000 elements, is reported as `unreadable`.
- At most `--limit` findings, projects and steps (default 200) are shown; the counts, the gate and the total cover all of them.
- Text shown in a report is cut to a fixed length: 300 characters for a name or a path, 1,200 for a message.

Every limit is reported, as an error or a note, so a cut is never silent.
