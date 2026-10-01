# Method

The tool answers one question: before a .NET Framework solution is moved to modern .NET, what does each project hold that the move has to deal with, and in what order can the projects be moved? It reads the solution file, the project files, `packages.config`, `web.config` and `app.config`, and counts files by kind. It turns every project into a record of its style, target frameworks, kind, packages, references and files, runs the checks below on those records, and orders the projects by their references. It never runs `dotnet`, `msbuild` or `nuget`, and it never fetches anything.

The way the checks are drawn follows Microsoft's guidance on moving code from .NET Framework: the [porting overview](https://learn.microsoft.com/en-us/dotnet/core/porting/) for the project-level steps (SDK-style project files, `PackageReference`, technologies that are not available on modern .NET, Windows-only APIs, and the advice to move libraries before the applications that use them), and the [ASP.NET to ASP.NET Core migration](https://learn.microsoft.com/en-us/aspnet/core/migration/proper-to-2x/) guide for the web side (`System.Web`, Web Forms, HTTP modules and handlers, configuration). Which versions of modern .NET are supported, and for how long, is set by the [.NET support policy](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core). The server side of WCF is available on modern .NET through the community project [CoreWCF](https://github.com/CoreWCF/CoreWCF).

## Why an inventory comes first

A .NET Framework web system is usually a solution of many projects: shared class libraries, data access, a WCF or ASMX service layer, one or more web applications, Windows services and tests. It is moved project by project, because each step has to leave a solution that still builds and still runs: a library is retargeted (often to .NET Standard, so both the old and the new applications can use it), then the services that depend on it, then the web applications on top. The porting overview describes this order: a project can only be moved once the projects it references can be used from the new target.

Two kinds of facts decide how much work each step is. The first kind is mechanical: an old-style project file has to be converted to the SDK style, `packages.config` has to become `PackageReference` items, binding redirects disappear. Tools help with these, and they are quick. The second kind is real rework: Web Forms pages have no counterpart in ASP.NET Core and are rebuilt, WCF services are moved to gRPC, REST or CoreWCF, HTTP modules become middleware, code that uses `System.Web` is rewritten, and Windows-only APIs either keep the application on Windows or are replaced. An inventory that lists both kinds per project, with the order in which projects can move, is what a plan, an estimate and the first pull request are built on.

A finding is an **error** when the inventory itself is incomplete: a project the solution names does not exist, a file could not be read, or projects reference each other in a loop. A report with an error does not describe the whole solution, so the run fails by default. A finding is a **warning** when the project needs work before or during the move. It is **info** when the fact is useful for planning but not work in itself, or when the project is already where it needs to be.

## How the files are read

**Solution files.** The first line that is not empty must be the solution header (`Microsoft Visual Studio Solution File, Format Version ...`); anything else is refused. Every `Project("{type}") = "name", "path", "{id}"` line is read. Entries of the solution folder type are folders; entries whose path ends in `.csproj`, `.vbproj` or `.fsproj` are projects; other entries (web site projects, database projects, installers) are listed in a note and not read. The `NestedProjects` section is read to give each project its solution folder. Paths are written with backslashes; they are turned into forward slashes, so they resolve the same way on Windows, Linux and macOS.

**Project files.** A project file is SDK-style when its `<Project>` element has an `Sdk` attribute, or it holds an `<Sdk Name="...">` element or an `<Import Sdk="...">`; otherwise it is old-style. Old-style files usually carry `ToolsVersion` and the MSBuild XML namespace; neither is required. Properties are read from every `PropertyGroup` outside a `<Target>`: an unconditional value replaces an earlier one (the last one wins, as in MSBuild), and a value under a `Condition` is used only when nothing else sets the property. A value that holds `$(...)` is something MSBuild works out at build time; it is not used, and a note says so. Items are read from every `ItemGroup` outside a `<Target>`: `PackageReference` (with the version as an attribute or an element), `ProjectReference`, `Reference` (the assembly name before the first comma) and `FrameworkReference`. Element names are compared ignoring case, as MSBuild compares property and item names.

**Target frameworks.** `TargetFrameworks` (several, separated by `;`) wins over `TargetFramework`, which wins over the old-style `TargetFrameworkVersion`. Each moniker is put in a family: `v4.7.2`, `net472`, `net48`, `net481` and older ones are **.NET Framework**; `netstandard2.0` and other `netstandardX.Y` are **.NET Standard**; `netcoreappX.Y` and `net5.0` and later (with an optional platform such as `-windows`) are **modern .NET**; anything else is unknown and is shown as written.

**packages.config, web.config, app.config.** These are read only when they sit in the folder of a project file, and their names are compared ignoring case. From `packages.config` every `<package>` is read with its id, version and target framework. From `web.config` and `app.config` only these parts are read: `system.serviceModel` (the `<service>` entries under `<services>` and the `<endpoint>` entries under `<client>`), `system.web/httpModules`, `system.web/httpHandlers`, `system.webServer/modules`, `system.webServer/handlers`, `runtime/assemblyBinding/dependentAssembly` (binding redirects), and the `targetFramework` attributes of `compilation` and `httpRuntime`. Section names are compared exactly, as the .NET configuration system does. Nothing else in a config file is read, and no value from it (connection strings, keys, addresses) is ever shown.

**The XML reader.** All of these files are read by a small XML reader written for this tool. It reads elements, attributes, text, CDATA sections, comments, processing instructions, the five predefined entities and character references. A DOCTYPE or an ENTITY declaration is refused before anything in it is read: project and config files never need one, and a DOCTYPE is how a file would define entities that expand into large text or point at other files. An entity other than the five predefined ones is refused for the same reason. A file that is not well-formed (a tag that is not closed, a second root element, an attribute given twice) is refused with its line. A refused file is reported as `unreadable`; the rest of the solution is still read.

**Files by kind.** The folder is walked, skipping `bin`, `obj`, `packages`, `node_modules`, `.git` and `.vs`, and files are counted by their extension, ignoring case: `.aspx` Web Forms pages, `.ascx` user controls, `.master` master pages, `Global.asax`, `.svc` WCF service files, `.asmx` ASMX web services, `.cshtml` and `.vbhtml` Razor views, and `.cs`, `.vb` and `.fs` code files. Each file is counted for the project whose folder is the nearest one above it.

**Paths and letter case.** A path from a solution or project file is resolved against the folder of the file that holds it, with either separator. On Windows, paths are not case-sensitive, and solutions often name a folder `Models` that is `models` on disk. The tool looks up each part of a path ignoring case, as Windows does, so the same project is found on every system; when the case differs from the file on disk, a note says so, because a build on Linux or macOS would not find the file. A path that leads outside the folder being scanned, a Windows drive path on Linux or macOS, and a link (symbolic link or junction) that leads outside the folder are never read.

## The checks

| Id | Severity | Rule and why it matters for the move |
| --- | --- | --- |
| `missing-project` | error | The solution lists a project file that does not exist, or a project references one that does not exist. The solution does not build as it is, and the inventory cannot describe that project; fix the solution before planning the move |
| `unreadable` | error | A solution, project or config file is over the size limit, not well-formed XML, holds a DOCTYPE, or lies outside the folder (also through a link). The report would be incomplete without it, so it is an error, not a silent skip |
| `reference-cycle` | error | Projects reference each other in a loop. MSBuild cannot build such projects, and no project in the loop can be moved before the others; the loop has to be broken first. Every loop is reported once, with its projects in order |
| `old-style-project` | warning | The project file has no SDK: modern .NET builds only SDK-style project files. Converting it is the first step for every project, and the porting overview describes it; the .NET Upgrade Assistant helps with the conversion, and the result is checked by hand |
| `packages-config` | warning | The project lists its packages in `packages.config`. SDK-style projects restore only `PackageReference` items, so the packages move into the project file; the porting overview lists this as a step before retargeting. Visual Studio can migrate the file |
| `web-forms` | warning | The project has `.aspx` pages, `.ascx` user controls or `.master` pages. ASP.NET Core has no Web Forms and no direct equivalent: the migration guide points to Razor Pages, MVC or Blazor, and each page is rebuilt. Usually the largest item of a web move, so the counts are shown |
| `wcf-service` | warning | The project hosts WCF services: `.svc` files, or `<service>` entries in `system.serviceModel` of its `web.config` or `app.config`. Modern .NET has no WCF server of its own; services are moved to gRPC or REST on ASP.NET Core, or to [CoreWCF](https://github.com/CoreWCF/CoreWCF), which keeps the service contracts |
| `asmx-service` | warning | The project has `.asmx` web services. ASP.NET Core does not run them; they are rebuilt as ASP.NET Core APIs, or as SOAP services on CoreWCF when callers need SOAP |
| `system-web` | warning | The project references `System.Web` or an assembly below it (`System.Web.Extensions`, `System.Web.Mvc`, `System.Web.Http`, `System.Web.Services` and others). The migration guide explains that `System.Web` is not part of ASP.NET Core: code that uses `HttpContext.Current`, the session, the page model, `HttpModule` or `HttpHandler` is rewritten. A library that references it cannot be used from ASP.NET Core as it is |
| `http-modules` | warning | `web.config` registers HTTP modules or handlers (`system.web` and `system.webServer`). The migration guide describes how each becomes middleware in ASP.NET Core; they often hold authentication, logging or rewriting that the new application needs on day one |
| `framework-target` | info | The project targets .NET Framework; the versions are listed, as `TargetFrameworkVersion` or the `net4x` moniker writes them. Projects on older versions may need a step to .NET Framework 4.7.2 or later first, so that libraries targeting .NET Standard 2.0 can be used |
| `windows-only` | info | The project references assemblies or packages whose APIs run on modern .NET only on Windows: `System.Drawing`, `Microsoft.Win32.Registry`, `System.Management`, `System.DirectoryServices`, `System.ServiceProcess`, `System.Diagnostics.EventLog`, Windows Forms, WPF, or it targets `-windows` or sets `UseWindowsForms` / `UseWPF`. The porting overview lists these: the project can move, but it stays on Windows unless they are replaced, which matters when the goal is Linux containers |
| `binding-redirects` | info | `web.config` or `app.config` holds assembly binding redirects. Modern .NET does not use them; the versions they unify should still agree after the packages move to `PackageReference` |
| `wcf-client` | info | `web.config` or `app.config` configures WCF client endpoints. On modern .NET a WCF client uses the `System.ServiceModel` client packages and is configured in code, not in the config file |
| `netstandard-library` | info | The project targets .NET Standard. It already runs on modern .NET and on .NET Framework, so it can stay as it is while the projects around it move, or move first |
| `sdk-ready` | info | The project already targets modern .NET. The version is listed so it can be compared with the [.NET support policy](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core) |

## How the project kind is guessed

The kind is a guess from facts in the files, in this order; the first rule that matches wins:

1. **test**: `IsTestProject` is true, the test project type id is in `ProjectTypeGuids`, or a test package is referenced (`Microsoft.NET.Test.Sdk`, xUnit, NUnit, MSTest).
2. **ASP.NET Core web**: the SDK is `Microsoft.NET.Sdk.Web`.
3. **WCF service**: the project folder has `.svc` files, its config file has `<service>` entries, or the WCF project type id is set.
4. **Web Forms**: the folder has `.aspx`, `.ascx` or `.master` files.
5. **MVC**: `System.Web.Mvc` or the `Microsoft.AspNet.Mvc` package is referenced, an MVC project type id is set, or a web project has Razor views.
6. **Web API**: `System.Web.Http` or a `Microsoft.AspNet.WebApi` package is referenced.
7. **ASMX web service**: the folder has `.asmx` files.
8. **web application**: the web application project type id, the `Microsoft.WebApplication.targets` import, or a library with a `web.config` that references `System.Web`.
9. **Windows service**: `System.ServiceProcess` is referenced and the output is an executable.
10. **desktop (WPF)** or **desktop (WinForms)**: `UseWPF`, `UseWindowsForms`, the WPF project type id, or references to WPF or Windows Forms assemblies.
11. **console** for an `Exe`, **desktop** for another `WinExe`, and **class library** for everything else.

A project with both Web Forms pages and MVC controllers is reported as Web Forms, since the pages are the larger piece of work; the counts in the JSON report show both.

## How the move order is worked out

Every project that could be read is a node, and every project reference that points at another project of the scan is an edge. The order is a topological order: a project comes after every project it references, so each step only depends on steps already taken. Among the projects that are ready at each point, the tool picks by group and then by name:

1. libraries that already target only .NET Standard or modern .NET,
2. other class libraries,
3. services: WCF services, Web API projects, ASMX web services, Windows services and console applications,
4. applications: Web Forms, MVC, ASP.NET Core and other web applications, and desktop applications,
5. tests.

This follows the porting overview: move libraries first, so the applications that depend on them can follow. A reference always wins over the group: a library that references a service comes after that service. When projects reference each other in a loop, no order exists for them; each loop is reported as `reference-cycle`, and the projects in loops, and the projects that depend on them, are listed last and marked. A project that could not be read is left out of the order, and a note says so.

The order is a suggestion for planning, not a rule: a team may move a web application early behind a proxy, or keep a library on .NET Standard for good. What it does make sure of is that no step depends on a project that has not been moved yet.

## The gate

`--fail-on error`, the default, makes the run exit with `1` when the inventory is incomplete: a missing or unreadable project or file, or a reference loop. `--fail-on warning` also fails on any warning, which suits a solution that is meant to be fully moved: a new old-style project or a new `packages.config` then fails the pull request. Info never fails a run. The gate counts every finding, also those beyond `--limit`, which only shortens the lists that are shown.

## The report

Each report shows the input, the number of solutions and projects by style, the number of files by kind, a table of every project with its style, targets, kind, packages and references, the move order, the findings ordered by severity, check and file, the notes, and the gate. Every text taken from the input has control characters removed before it reaches any format, and paths are shown relative to the scanned folder, with forward slashes.

The method has no randomness and no network access: the same files always give the same report, and any change in the report comes from a change in the files.
