# Threat model

## What the tool touches

- It reads the folder or `.sln` file given with `--path`: the solution files, the project files they name (or every project file in the folder), the `packages.config`, `web.config` and `app.config` next to each project, and the names and sizes of the other files in the folder. Everything it reads lies inside that folder, both as written and after links are followed. Nothing inside the files is run, built, restored, fetched or followed as a link.
- It writes only to the screen (standard output and standard error).
- It opens no network connection and runs no program: not `dotnet`, not `msbuild`, not `nuget`, not a shell.

## What the input may hold

A solution under study is often old, large and not well known to the people moving it, and it may come from a customer, a vendor or an acquired company. The tool treats every file as possibly hostile. A project file is XML that MSBuild would run: it can hold targets, tasks and inline code that execute at build time, imports from anywhere on the disk, and property functions. A solution file can name projects by `..\..\` paths or absolute paths that leave the folder, or by Windows drive and network paths. Any XML file can hold a DOCTYPE with entity declarations meant to expand into gigabytes of text or to read another file, very deep nesting, or attribute names meant to reach an object's prototype. A config file can hold connection strings, passwords and keys. Folder trees can hold links or junctions that lead to other parts of the disk, loops of links, or millions of files. Names of projects and files can hold control characters or text meant for a spreadsheet or a Markdown table.

## What could go wrong, and what stops it

| Risk | Control |
| --- | --- |
| A project file runs code on the machine that scans it (a target, an inline task, a property function, a package's build script) | The tool never runs MSBuild, `dotnet` or NuGet, and never evaluates a property; project files are read as data. There is no code path that starts a process |
| A DOCTYPE defines entities that expand exponentially (a "billion laughs" file) or an external entity that reads `/etc/passwd` or a network address | The XML reader refuses any DOCTYPE or ENTITY declaration before it reads what is inside, and refuses every entity except the five that XML predefines; nothing is ever expanded or fetched |
| A solution names `..\..\..\Users\someone\secrets.csproj`, an absolute path, or `C:\` or `\\server\share` paths, so the tool reads files outside the solution and shows them | Every path is resolved against the folder of the file that names it and must lie inside the scanned folder; a Windows drive path cannot be read on Linux or macOS and is checked on Windows like any other path. Anything outside is reported as `unreadable` and never opened |
| A link or junction inside the folder points elsewhere on the disk, so the walk reads or counts files outside the solution | Every link is resolved to its real path and checked against the real path of the scanned folder; links that lead outside are never followed. Links to folders are not followed at all, so a loop of links cannot make the walk run forever |
| A project reference leads outside the folder | It is noted and not followed |
| A config file shows a connection string, password or key in a report, a job summary or a CSV file | Only the sections listed in docs/method.md are read, and only names are shown: module, handler, service, endpoint and assembly names. No attribute value from `connectionStrings`, `appSettings` or an endpoint address reaches any report |
| A huge file, deeply nested XML, very many elements, projects or files exhaust memory or time | Files over 20 MB are not read; XML deeper than 64 levels or with more than 500,000 elements is refused; more than 5,000 projects, 500,000 files or 64 folder levels stop the run. The XML reader and the folder walk use their own stacks, not recursion, and every pattern is anchored and free of nested repetition |
| An attribute named `__proto__` or `constructor` changes how objects behave | Attributes are kept in objects without a prototype; tests check that no prototype changes |
| A malformed file is read differently from MSBuild, so a project is shown as cleaner than it is | Anything that is not well-formed XML is refused with its line and reported as an `unreadable` error, which fails the run; nothing is guessed |
| A solution with a missing project, or a file the tool refuses, gives a report that looks complete | Both are errors (`missing-project`, `unreadable`) and fail the run by default |
| A project name or path rewrites the terminal through escape sequences, or reorders text with direction characters | Control characters (C0 and C1), line and paragraph separators and Unicode direction controls are replaced by a space before any text reaches a report, and the length is capped |
| A project name breaks the Markdown table in the job summary | Pipes, backslashes and line breaks are escaped in every table cell |
| A CSV report runs a formula when opened in a spreadsheet | Cells that start with `=`, `+`, `-`, `@`, a tab or a carriage return get a leading `'`; every cell is quoted as RFC 4180 says |
| A report shows the absolute paths of the machine that ran it | Paths are shown relative to the scanned folder; only the input is shown as it was given |
| `--path` names a URL, so the tool becomes a fetcher | Addresses are refused; the tool has no code that opens a connection |

## Out of scope

What the code inside the projects does, whether packages have known vulnerabilities, whether the solution builds, and what MSBuild would compute from imports and conditions. docs/limits.md lists what a file inventory cannot see.
