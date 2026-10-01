# Changes

## 1.0.0

First release.

- Makes an inventory of a .NET Framework solution before it is moved to modern .NET. Reads files only; never runs `dotnet`, MSBuild or NuGet and never fetches anything.
- Reads `.sln` files (projects, solution folders, Windows backslash paths), old-style and SDK-style project files (`.csproj`, `.vbproj`, `.fsproj`) including multi-targeting, `packages.config`, and the services, client endpoints, HTTP modules and handlers, binding redirects and target frameworks in `web.config` and `app.config`.
- A small XML reader that refuses DOCTYPE and ENTITY declarations and every entity except the five XML predefines, and stops at the line of anything that is not well-formed.
- Counts Web Forms pages, user controls, master pages, `Global.asax`, WCF `.svc` files, ASMX services, Razor views and code files for each project.
- For each project: style, language, output type, target frameworks, a guess at its kind, packages from `packages.config` or `PackageReference`, project references, and references to assemblies that exist only in .NET Framework.
- Sixteen checks: `missing-project`, `unreadable`, `reference-cycle`, `old-style-project`, `packages-config`, `web-forms`, `wcf-service`, `asmx-service`, `system-web`, `http-modules`, `framework-target`, `windows-only`, `binding-redirects`, `wcf-client`, `netstandard-library` and `sdk-ready`.
- A suggested move order: every project after the projects it references, libraries first, then services, then applications, then tests; loops of references are reported.
- Paths from solution and project files are read with either separator and compared ignoring case, as on Windows, on every system; a difference in case is noted.
- Reports as text, Markdown, JSON and CSV (`--limit`, with the total always shown); `--fail-on` for a pipeline gate.
- Safe input: reads only inside the given folder, never follows links that lead outside it, skips `bin`, `obj`, `packages`, `node_modules`, `.git` and `.vs`; files over 20 MB, more than 5,000 projects, more than 500,000 files and folders nested more than 64 deep are refused; control characters are removed from every text shown, and no config value is ever shown.
- Release packages come with a CycloneDX SBOM, SHA-256 checksums and a build provenance attestation.
