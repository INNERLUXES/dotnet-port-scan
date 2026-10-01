# dotnet-port-scan

Makes an inventory of a .NET Framework solution before it is moved to modern .NET. It reads the `.sln` file, every project file, `packages.config`, `web.config` and `app.config`, and counts the Web Forms, WCF, ASMX and Razor files in each project. For every project it reports the project style, the target frameworks, what kind of application it is, its packages and references, and the parts that have no direct counterpart in modern .NET, and it suggests the order in which to move the projects.

A .NET Framework web system is rarely moved in one step. It is moved project by project: shared libraries first, then the services that use them, then the web applications on top, with the solution still building after each step. Before the first project is touched, a team needs to know what is in the solution: which projects are still old-style project files, which ones use `packages.config`, which ones have Web Forms pages, WCF services or ASMX web services, which reference `System.Web` or Windows-only APIs, which HTTP modules and handlers sit in `web.config`, and which projects depend on which. In a solution with dozens of projects that is a day of opening files by hand, and easy to get wrong. This tool reads those files and writes the list, in plain words, in a few seconds.

- Every finding has an id, a severity (error, warning, info), the project, the file and a plain message with what to do.
- It reads `.sln` files with the Windows paths they hold, old-style project files (`<Project ToolsVersion="...">`) and SDK-style ones (`<Project Sdk="...">`), including multi-targeting with `TargetFrameworks`.
- It reads XML with a small, strict reader of its own that refuses a DOCTYPE or an entity declaration, so a project file cannot make it expand entities or read another file.
- It guesses the kind of each project (Web Forms, MVC, Web API, WCF service, ASMX web service, class library, console, Windows service, WinForms or WPF desktop, test) and orders the projects for the move: every project after the projects it references, libraries first, then services, then applications.
- Reports as text, Markdown, JSON and CSV.
- It reads files only. It never runs `dotnet`, `msbuild` or `nuget`, builds nothing, restores nothing, fetches nothing and opens no network connection.
- Plain JavaScript, no dependencies; the same files always give the same report.

```
npm test
```

```
ℹ tests 57
ℹ pass 57
ℹ fail 0
```

## Quick start

Requires Node 22 or newer. There is nothing to install.

```
git clone https://github.com/INNERLUXES/dotnet-port-scan.git
cd dotnet-port-scan
node bin/dotnet-port-scan.js --path examples/OrdersPortal.sln
```

Or without a clone, in the folder of your solution:

```
npx --yes github:INNERLUXES/dotnet-port-scan --path MySolution.sln
```

`examples/` holds a made-up legacy solution, `OrdersPortal.sln`, with five projects: an old-style Web Forms application (`OrdersPortal.Web`, with `packages.config` and a `web.config` that registers an HTTP module and handler and calls a WCF service), an old-style WCF service application with one ASMX web service next to it, an old-style class library on .NET Framework 4.8, a library already moved to `netstandard2.0`, and an SDK-style test project on `net8.0`. All names are made up, and the pages and code files hold placeholder content.

## Usage

```
node bin/dotnet-port-scan.js --path examples/OrdersPortal.sln
```

```
dotnet-port-scan: examples/OrdersPortal.sln
solutions: 1; projects: 5 (3 old-style, 2 SDK-style)
files: 3 Web Forms pages, 1 user control, 1 master page, 1 Global.asax, 1 WCF service, 1 ASMX service, 0 Razor views, 12 code files
findings: 0 error, 11 warning, 10 info

Project                 Style      Target          Kind           Packages              References
OrdersPortal.Web        old-style  v4.7.2          Web Forms      3 (packages.config)   OrdersPortal.Core, OrdersPortal.Contracts
OrdersPortal.Services   old-style  v4.8            WCF service    -                     OrdersPortal.Core, OrdersPortal.Contracts
OrdersPortal.Core       old-style  v4.8            class library  1 (packages.config)   OrdersPortal.Contracts
OrdersPortal.Contracts  sdk        netstandard2.0  class library  -                     -
OrdersPortal.Tests      sdk        net8.0          test           2 (PackageReference)  OrdersPortal.Contracts

Move order: each project after the projects it references; libraries first, then services, then apps, then tests
Step  Project                 Group    After
1     OrdersPortal.Contracts  library  -
2     OrdersPortal.Core       library  OrdersPortal.Contracts
3     OrdersPortal.Services   service  OrdersPortal.Core, OrdersPortal.Contracts
4     OrdersPortal.Web        app      OrdersPortal.Core, OrdersPortal.Contracts
5     OrdersPortal.Tests      test     OrdersPortal.Contracts

WARNING   old-style-project    src/OrdersPortal.Core/OrdersPortal.Core.csproj  OrdersPortal.Core is an old-style project file (no Sdk attribute, ToolsVersion 15.0); modern .NET builds only SDK-style projects. Convert it to the SDK style first; the .NET Upgrade Assistant helps with this

WARNING   old-style-project    src/OrdersPortal.Services/OrdersPortal.Services.csproj  OrdersPortal.Services is an old-style project file (no Sdk attribute, ToolsVersion 15.0); modern .NET builds only SDK-style projects. Convert it to the SDK style first; the .NET Upgrade Assistant helps with this

WARNING   old-style-project    src/OrdersPortal.Web/OrdersPortal.Web.csproj  OrdersPortal.Web is an old-style project file (no Sdk attribute, ToolsVersion 15.0); modern .NET builds only SDK-style projects. Convert it to the SDK style first; the .NET Upgrade Assistant helps with this

WARNING   packages-config      src/OrdersPortal.Core/packages.config  OrdersPortal.Core lists 1 package in packages.config (Example.Json); SDK-style projects restore only PackageReference items. Move them into the project file as PackageReference

WARNING   packages-config      src/OrdersPortal.Web/packages.config  OrdersPortal.Web lists 3 packages in packages.config (Example.Json, Example.Logging, Example.Web.Optimization); SDK-style projects restore only PackageReference items. Move them into the project file as PackageReference

WARNING   web-forms            src/OrdersPortal.Web/OrdersPortal.Web.csproj  OrdersPortal.Web has 3 Web Forms pages, 1 user control, 1 master page; ASP.NET Core has no Web Forms and no direct equivalent. Rebuild these pages in Razor Pages, MVC or Blazor

WARNING   wcf-service          src/OrdersPortal.Services/OrdersPortal.Services.csproj  OrdersPortal.Services hosts WCF services (1 .svc file, 1 service in src/OrdersPortal.Services/Web.config); modern .NET has no WCF server. Move them to gRPC or REST on ASP.NET Core, or to CoreWCF

WARNING   asmx-service         src/OrdersPortal.Services/OrdersPortal.Services.csproj  OrdersPortal.Services has 1 ASMX web service (.asmx); ASP.NET Core does not run them. Rebuild them as ASP.NET Core APIs, or as SOAP services on CoreWCF

WARNING   system-web           src/OrdersPortal.Services/OrdersPortal.Services.csproj  OrdersPortal.Services references System.Web, System.Web.Services; System.Web is not available in ASP.NET Core. Code that uses HttpContext.Current, the session, the page model or HTTP modules has to be rewritten against ASP.NET Core

WARNING   system-web           src/OrdersPortal.Web/OrdersPortal.Web.csproj  OrdersPortal.Web references System.Web, System.Web.Extensions; System.Web is not available in ASP.NET Core. Code that uses HttpContext.Current, the session, the page model or HTTP modules has to be rewritten against ASP.NET Core

WARNING   http-modules         src/OrdersPortal.Web/Web.config  src/OrdersPortal.Web/Web.config registers 1 HTTP module (OrdersAuditModule) and 1 HTTP handler (OrderChart) for OrdersPortal.Web; ASP.NET Core has no modules or handlers. Rewrite them as middleware

INFO      framework-target     src/OrdersPortal.Core/OrdersPortal.Core.csproj  OrdersPortal.Core targets .NET Framework 4.8 (v4.8)

INFO      framework-target     src/OrdersPortal.Services/OrdersPortal.Services.csproj  OrdersPortal.Services targets .NET Framework 4.8 (v4.8)

INFO      framework-target     src/OrdersPortal.Web/OrdersPortal.Web.csproj  OrdersPortal.Web targets .NET Framework 4.7.2 (v4.7.2)

INFO      windows-only         src/OrdersPortal.Services/OrdersPortal.Services.csproj  OrdersPortal.Services uses Windows-only APIs: System.DirectoryServices; on modern .NET they run only on Windows, so the moved project stays on Windows unless they are replaced

INFO      windows-only         src/OrdersPortal.Web/OrdersPortal.Web.csproj  OrdersPortal.Web uses Windows-only APIs: System.Drawing; on modern .NET they run only on Windows, so the moved project stays on Windows unless they are replaced

INFO      binding-redirects    src/OrdersPortal.Core/App.config  src/OrdersPortal.Core/App.config has 1 assembly binding redirect (Example.Json 12.0.0.0); modern .NET does not use binding redirects. Check that the package versions they unify still agree after the move

INFO      binding-redirects    src/OrdersPortal.Web/Web.config  src/OrdersPortal.Web/Web.config has 2 assembly binding redirects (Example.Json 12.0.0.0, Example.Logging 4.1.0.0); modern .NET does not use binding redirects. Check that the package versions they unify still agree after the move

INFO      wcf-client           src/OrdersPortal.Web/Web.config  src/OrdersPortal.Web/Web.config configures 1 WCF client endpoint (OrderService); on modern .NET a WCF client uses the System.ServiceModel client packages and is configured in code, not in the config file

INFO      netstandard-library  src/OrdersPortal.Contracts/OrdersPortal.Contracts.csproj  OrdersPortal.Contracts targets netstandard2.0 and already runs on modern .NET; move it first or keep it as it is

INFO      sdk-ready            tests/OrdersPortal.Tests/OrdersPortal.Tests.csproj  OrdersPortal.Tests already targets modern .NET (net8.0); compare the version with the .NET support policy

GATE: PASS (--fail-on error)
```

The exit code is `0`: nothing here stops a build, and every warning is work for the move. Paths in the report are relative to the folder of the solution. `--path examples` gives the same report, read from the folder instead of the solution file. With `--fail-on warning` the same run fails with `GATE: FAIL - 11 warnings` and exit code `1`.

The move order reads from the references: `OrdersPortal.Contracts` references nothing and is already portable, `OrdersPortal.Core` needs only it, the WCF service and the Web Forms application both stand on the two libraries, and the test project comes last. Two projects that reference each other in a loop cannot be ordered; they are listed last and reported as `reference-cycle`.

```
dotnet-port-scan --path <folder or .sln> [options]
```

```
--path <path>       the folder of the solution, or its .sln file
--format <name>     text, markdown, json or csv (default: text)
--fail-on <level>   exit with 1 when a finding is at this level or above: error or warning
                    (default: error)
--limit <n>         show at most n findings, projects and steps (default: 200); the total is
                    always shown
--help              show the usage
--version           show the version
```

Given a `.sln` file, the tool reads the projects the solution lists, and notes project files in the folder that the solution leaves out. Given a folder, it reads every project file below it and every `.sln` file it finds, so a missing project is still reported. Paths in solution and project files are written with backslashes; they are read with either separator on every system, and compared ignoring letter case, as Windows does. A path whose case differs from the file on disk is found, and named in a note, because Linux and macOS would not find it.

## Checks

| Id | Severity | What it reports |
| --- | --- | --- |
| `missing-project` | error | The solution, or a project reference, points at a project file that does not exist |
| `unreadable` | error | A solution, project or config file the tool refuses or cannot read: not well-formed XML, a DOCTYPE, over 20 MB, or outside the folder (also through a link) |
| `reference-cycle` | error | Projects that reference each other in a loop, so there is no order to build or move them in |
| `old-style-project` | warning | An old-style (non-SDK) project file; it needs converting to the SDK style before it can target modern .NET |
| `packages-config` | warning | Packages listed in `packages.config`; move them to `PackageReference` items |
| `web-forms` | warning | Web Forms pages, user controls or master pages (`.aspx`, `.ascx`, `.master`); ASP.NET Core has no direct equivalent, so they are rebuilt in Razor Pages, MVC or Blazor |
| `wcf-service` | warning | WCF services hosted by the project (`.svc` files, or services in `web.config`); move them to gRPC or REST, or to CoreWCF |
| `asmx-service` | warning | ASMX web services (`.asmx` files), which ASP.NET Core does not run |
| `system-web` | warning | A reference to `System.Web` or an assembly below it, which is not available in ASP.NET Core |
| `http-modules` | warning | HTTP modules or handlers registered in `web.config`; in ASP.NET Core they become middleware |
| `framework-target` | info | The project targets .NET Framework; the version is listed |
| `windows-only` | info | References to APIs that run on modern .NET only on Windows: `System.Drawing`, the registry, `System.Management`, `System.DirectoryServices`, Windows Forms, WPF and others |
| `binding-redirects` | info | Assembly binding redirects in `web.config` or `app.config`, which modern .NET does not use |
| `wcf-client` | info | WCF client endpoints in `web.config` or `app.config`; on modern .NET the client is configured in code |
| `netstandard-library` | info | The project targets .NET Standard and already runs on modern .NET |
| `sdk-ready` | info | The project already targets modern .NET |

[docs/method.md](docs/method.md) gives each check, how project kinds and the move order are worked out, and why each one matters for a move.

## Formats

- `text`: for a terminal: the summary, the project table, the move order, then the findings, errors first.
- `markdown`: the same for a pull request comment, an issue or the job summary. Pipes and line breaks from the input are escaped, so a project name cannot break a table.
- `json`: the whole report: every project with its style, language, output type, targets, kind, packages, project references, framework-only and Windows-only references and file counts; the move order and any loops; every finding.
- `csv`: one row per finding, per project and per step of the move order, quoted as RFC 4180 says. A cell that starts with `=`, `+`, `-` or `@` gets a leading `'`, so a spreadsheet does not run it as a formula.

## Exit codes

`0` no finding at the `--fail-on` level, `1` at least one such finding (by default: an error), `2` a usage or input error (a missing option, a path that does not exist, a file that is neither a folder nor a `.sln` file, a `.sln` file that is not a solution or is over 20 MB, more than 5,000 projects, more than 500,000 files in the folder, folders nested more than 64 deep).

## Use in CI

The inventory can run on every pull request of a solution that is being moved, so the report shows what is left and a change that adds a new old-style project or a new `packages.config` is seen:

```yaml
permissions:
  contents: read
steps:
  - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
  - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
    with:
      node-version: 22
  - name: .NET move inventory
    run: npx --yes github:INNERLUXES/dotnet-port-scan --path MySolution.sln --format markdown >> "$GITHUB_STEP_SUMMARY"
```

It needs no .NET SDK on the build machine, no package restore and no secrets. With the default `--fail-on error` the step fails only on a missing or unreadable project or a reference loop; add `--fail-on warning` once a solution is meant to be fully moved, so that nothing old-style comes back.

## Limits

This is a file inventory, not a compiler. It does not look at the code inside the projects, so it cannot say which APIs the code calls or whether it compiles on modern .NET: use Microsoft's .NET Upgrade Assistant and the API analyzers for that. MSBuild is not run, so properties that MSBuild works out from other properties, imports, `Directory.Build.props` or conditions are not evaluated; such values are named in a note. C# projects are covered best; VB.NET and F# projects are read, but only partly covered. [docs/limits.md](docs/limits.md) lists these, with the size limits.

## Background

- How .NET Framework web systems are moved to modern .NET project by project, with an inventory like this one as the first step: [.NET web development](https://innerluxes.dev/web-development/dotnet).

## License

MIT
