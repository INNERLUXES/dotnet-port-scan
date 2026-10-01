# Secure defaults

The default run is the safe run. Nothing below needs a flag, and none of it can be switched off.

## How the tool behaves by default

- **No network.** The tool reads the files it is given and sends nothing anywhere. It does not ask a NuGet feed about a package, does not resolve host names, does not follow a URL from a solution, project or config file, does not download a package or an imported `.targets` file, and does not check for updates. An address given with `--path` is refused. It can run in a locked-down job with no outbound access at all.
- **No MSBuild, no .NET, no commands.** The tool never runs MSBuild, `dotnet`, NuGet, Visual Studio, a shell or any other program. Project files are read as data: targets, tasks, inline code, property functions and imports in them are never evaluated. No name, path or value from the input is ever put on a command line. A solution from an unknown source can be scanned without running any of its code, which is not true of opening it in an IDE or building it.
- **No dependencies.** Node 22 or newer and nothing else, so an inventory of a codebase does not add a supply chain of its own. There is no `node_modules` to install before it runs.
- **Safe XML.** Every XML file is read by a small reader that refuses a DOCTYPE or an ENTITY declaration before reading anything in it, and refuses every entity except `&lt;`, `&gt;`, `&amp;`, `&quot;` and `&apos;`. No entity is ever expanded beyond those five, no external file or address named in an entity is ever opened, and a "billion laughs" file is refused at its first line. Nesting deeper than 64 levels and more than 500,000 elements in one file are refused too.
- **Strict parsing.** A file that is not well-formed XML (a tag that is not closed, a second root element, an attribute given twice, a stray `<` or `&`) is refused with its file and line and reported as an `unreadable` error, instead of a report that skipped the part it did not understand. A `.sln` file whose header is wrong, or with a `Project` line that cannot be read, is refused the same way.
- **Reads stay inside the folder.** Every path from a solution or project file is resolved against the folder of the file that names it, with either separator, and must lie inside the folder given with `--path`. A `..\..\` path that leaves it, an absolute path elsewhere, and a Windows drive or network path are never opened. The folder itself is resolved to its real path first, and every file is checked against that real path after links are followed.
- **Links are not followed out.** Symbolic links and junctions that lead outside the folder are skipped, with a note. Links to folders are not followed at all, even inside the folder, so a loop of links cannot make the walk run forever and nothing is counted twice.
- **Secrets stay out of reports.** Only the parts of `web.config` and `app.config` that matter for a move are read: services, client endpoints, modules, handlers, binding redirects and target framework attributes. Only names are shown. Connection strings, `appSettings`, passwords, keys and endpoint addresses are never read into a report, so a report can be pasted into a pull request, a ticket or a job summary.
- **No local paths in reports.** Paths are shown relative to the scanned folder, with forward slashes, so a report does not show the user name or folder layout of the machine that made it. Only the input is shown as it was given.
- **Bounded input.** A file over 20 MB is not read. More than 5,000 projects, more than 500,000 files in the folder or folders nested more than 64 deep stop the run with exit code 2 and the reason. The XML reader, the folder walk and the move order use their own stacks rather than recursion, so a deep or wide input cannot exhaust the call stack.
- **Clean output.** Text from the input has control characters, line separators and direction controls removed and its length capped before it reaches a report, so a hostile project name cannot rewrite the terminal or reorder what a reader sees. Markdown cells escape pipes, backslashes and line breaks. CSV cells are quoted as RFC 4180 says, and a cell that a spreadsheet would read as a formula gets a leading `'`. No report renders a name as a link.
- **No prototype tricks.** Attributes are stored in objects without a prototype, so an attribute named `__proto__` or `constructor` is just data.
- **Incomplete is an error.** A project that the solution lists but that does not exist, a project reference to a missing file, a file the tool refuses or cannot read, and a loop of project references are errors that fail the run. A report that left a project out is never presented as a complete inventory.
- **Fails closed.** A missing option, a path that does not exist, an input that is neither a folder nor a `.sln` file, a solution file that is not a solution, or a limit stops the run with exit code 2 and the reason, instead of a report about part of the input.
- **The gate is on.** Without any option, an error makes the run exit with `1`. A pipeline that adds the tool notices a broken solution from the first run.
- **Writes nothing to disk.** The report goes to the screen. Redirect it to a file or the job summary only when you need to keep it.

## Running it safely on a solution you do not know

1. Run the inventory before anything else touches the solution: before opening it in an IDE, before `nuget restore` or `dotnet restore`, and before a build. Each of those runs code from the solution or its packages; the inventory does not.
2. Run it as a user with read access to the solution folder and nothing else. It needs no administrator rights, no package feed credentials, no source control credentials and no network.
3. Point `--path` at the solution folder or its `.sln` file, not at a home folder or a drive root. The tool reads only inside that folder, and a smaller folder gives a faster, clearer report.
4. Keep the files you were given unchanged while you scan them; the tool reads them and writes nothing, so the scan does not change what a later review sees.
5. Read the notes at the end of the report. They say which paths were outside the folder, which links were not followed, which entries are not C#, VB.NET or F# projects, and which values MSBuild would compute. Each one is something the inventory did not see.
6. Treat every `unreadable` error as a question. A project file refused for a DOCTYPE, an entity or broken XML may be damaged, may be made by an unusual tool, or may be built to attack whoever opens it.

## Running it in a pipeline safely

1. Run the inventory as its own step, with read access to the repository and nothing else: no feed credentials, no deploy keys, no cloud credentials. It needs none.
2. Use the tool from a pinned commit. `npx --yes github:INNERLUXES/dotnet-port-scan#<commit>` runs exactly the code that was reviewed, not whatever the default branch holds on the day.
3. Give it the `.sln` file the build uses, so the report covers what is built. Run it on the folder as well when a repository holds several solutions, or projects that no solution lists.
4. Keep the default `--fail-on error` while the move is under way, so the step fails only when the solution itself is broken: a missing project, a file that cannot be read, a loop of references.
5. Switch to `--fail-on warning` once a solution has been moved, so a pull request that brings back an old-style project, a `packages.config`, a `System.Web` reference or a Web Forms page is stopped.
6. Write the Markdown report to the job summary, so the reviewer sees what is left next to the change, and keep the exit code as the gate.
7. Keep the JSON report as a build artifact when the move is tracked over time; comparing two of them shows which projects moved and which findings are gone.
8. Keep the .NET Upgrade Assistant, the API analyzers and a dependency scanner in the pipeline next to it. The inventory says which projects need work and in what order; those tools look inside the code and the packages. None of them replaces the others.

## Moving a .NET Framework solution safely

The tool tells you what each project holds; these are the usual steps that keep a move safe, in the order they tend to pay off.

1. **Start from a build that works.** Fix `missing-project`, `unreadable` and `reference-cycle` findings first. A move that starts from a broken solution mixes two kinds of failure.
2. **Convert project files before retargeting.** Convert old-style projects to SDK-style while they still target .NET Framework, one project at a time, and check that the build output is the same. Then move `packages.config` to `PackageReference`. Both are mechanical, and doing them first keeps the later, harder steps small.
3. **Move libraries first.** Follow the move order: retarget class libraries to .NET Standard 2.0, or multi-target them (`net48;net8.0`), so the old applications and the new ones can use the same code during the move.
4. **Keep the old system running.** Move a web application behind a proxy route by route, so the old and new applications serve the same users while pages are rebuilt, instead of switching everything at once.
5. **Rebuild Web Forms pages deliberately.** Each `.aspx` page holds markup, code-behind and view state. Rebuild it in Razor Pages, MVC or Blazor with its tests, rather than translating it line by line.
6. **Replace WCF and ASMX services with care.** Callers depend on the service contract. Keep the contract on CoreWCF when callers cannot change, or publish a new gRPC or REST contract and move callers one by one.
7. **Turn modules and handlers into middleware early.** HTTP modules often hold authentication, auditing or URL rewriting. Move them before the pages that depend on them, and test them on their own.
8. **Decide about Windows-only APIs.** For each `windows-only` finding, decide whether the application stays on Windows or the API is replaced (for example `System.Drawing` by a cross-platform imaging library). The decision changes where the application can run.
9. **Remove binding redirects after the move.** Once packages are on `PackageReference` and the project targets modern .NET, binding redirects are no longer used; remove them and check that one version of each package is resolved.
10. **Keep secrets out of config files.** A move is a good point to take connection strings and keys out of `web.config` and into the secret store of the new hosting, rather than copying them into `appsettings.json`.
11. **Stay on a supported version.** Target a version of modern .NET that the .NET support policy still covers, and plan the next upgrade when the move is done.

## Sharing a report safely

1. A report shows project names, file paths inside the solution, package names and versions, assembly names, and the names of HTTP modules, handlers, WCF services and client endpoints. For an open-source project that is public anyway. For a private system it shows the structure of the system and the names of internal components: share it with the people who can see the code.
2. Values from config files are never shown: no connection strings, addresses, keys or settings. Names of modules, handlers, services and endpoints are shown as they are written, and can say something about the system.
3. A Markdown report in a job summary is visible to everyone who can see the pipeline runs of the repository. Use the text or JSON report when the audience should be smaller.
