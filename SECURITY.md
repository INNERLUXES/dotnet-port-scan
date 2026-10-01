# Security

## Reporting a problem

Write to info@innerluxes.dev with the subject line "dotnet-port-scan security", or use private vulnerability reporting on this repository. Please do not open a public issue for a vulnerability.

Include a small made-up solution, project file or config file that shows the problem, what you expected and what happened. Use made-up project, package and host names, and no real connection strings, keys, internal addresses or customer code.

## Scope

In scope:

- an input that makes the tool open a network connection, run a program (MSBuild, `dotnet`, NuGet, a shell), or evaluate anything in a project file
- an input that makes the tool read a file outside the folder given with `--path`, through a path in a solution or project file, a Windows drive or network path, or a link or junction
- an XML file that makes the reader expand an entity, read another file, or accept a DOCTYPE
- an input that makes the tool hang, take very long, or use unbounded memory or stack, such as deep nesting, a crafted solution file, a loop of links or a loop of project references
- a value from `connectionStrings`, `appSettings`, an endpoint address or another config value that appears in any report format or error message
- text from a project name, a path or a config file that breaks a Markdown table, injects a formula into a CSV report, or rewrites the terminal through control or direction characters
- an attribute or element name that changes how objects behave inside the tool
- a solution with a missing project, an unreadable file or a reference loop that is reported as complete, or a project reported without a finding that docs/method.md says it should have

Out of scope: what the code inside the projects does, known vulnerabilities in packages, whether the solution builds, and what MSBuild would compute from imports and conditions (docs/limits.md lists what a file inventory cannot see).

Read [docs/threat-model.md](docs/threat-model.md) for the rest.
