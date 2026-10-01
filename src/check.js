// Turns a scan of a .NET Framework solution into findings, a table of projects and a move order.
// docs/method.md gives the reason behind every check.

import { guessKind, nameMatches, FRAMEWORK_ONLY, WINDOWS_ONLY } from './project.js';
import { moveGroup, moveOrder } from './order.js';

export const SEVERITIES = ['error', 'warning', 'info'];
export const RANK = { error: 0, warning: 1, info: 2 };
export const DEFAULTS = { limit: 200 };

export const FINDINGS = [
  { id: 'missing-project', severity: 'error', what: 'The solution or a project reference points at a project file that does not exist' },
  { id: 'unreadable', severity: 'error', what: 'A solution, project or config file the tool refuses or cannot read: not well-formed XML, a DOCTYPE, over the size limit, or outside the folder' },
  { id: 'reference-cycle', severity: 'error', what: 'Projects reference each other in a loop, so there is no order to build or move them in' },
  { id: 'old-style-project', severity: 'warning', what: 'An old-style (non-SDK) project file; it needs converting to the SDK style before it can target modern .NET' },
  { id: 'packages-config', severity: 'warning', what: 'Packages are listed in packages.config; move them to PackageReference items' },
  { id: 'web-forms', severity: 'warning', what: 'Web Forms pages, user controls or master pages; ASP.NET Core has no Web Forms, so they are rebuilt in Razor Pages, MVC or Blazor' },
  { id: 'wcf-service', severity: 'warning', what: 'WCF services hosted by the project (.svc files or services in web.config); move them to gRPC or REST, or to CoreWCF' },
  { id: 'asmx-service', severity: 'warning', what: 'ASMX web services (.asmx files); ASP.NET Core does not run them' },
  { id: 'system-web', severity: 'warning', what: 'A reference to System.Web or an assembly below it; System.Web is not available in ASP.NET Core' },
  { id: 'http-modules', severity: 'warning', what: 'HTTP modules or handlers registered in web.config; in ASP.NET Core they become middleware' },
  { id: 'framework-target', severity: 'info', what: 'The project targets .NET Framework; the version is listed' },
  { id: 'windows-only', severity: 'info', what: 'References to APIs that run on modern .NET only on Windows, such as System.Drawing, the registry, System.Management or System.DirectoryServices' },
  { id: 'binding-redirects', severity: 'info', what: 'Assembly binding redirects in web.config or app.config; modern .NET does not use them' },
  { id: 'wcf-client', severity: 'info', what: 'WCF client endpoints in web.config or app.config; modern .NET has WCF client packages, configured in code' },
  { id: 'netstandard-library', severity: 'info', what: 'The project targets .NET Standard and already runs on modern .NET' },
  { id: 'sdk-ready', severity: 'info', what: 'The project already targets modern .NET' }
];

const ORDER = Object.fromEntries(FINDINGS.map((f, i) => [f.id, i]));
const SEVERITY = Object.fromEntries(FINDINGS.map((f) => [f.id, f.severity]));

export function isFindingId(id) {
  return Object.hasOwn(ORDER, id);
}

// Text from the input: control, line separator and direction characters replaced by a space, length capped.
export function safeText(value, max = 300) {
  const s = String(value).replace(/[\u0000-\u001f\u007f-\u009f\u200E\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069]/g, ' ');
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

export function meetsThreshold(severity, failOn) {
  return RANK[severity] <= RANK[failOn];
}

export function plural(n, one, many = `${one}s`) {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

// A short list for a message: the first items and how many more.
export function listOf(items, max = 6) {
  const unique = [...new Set(items)];
  return unique.length > max ? `${unique.slice(0, max).join(', ')} and ${unique.length - max} more` : unique.join(', ');
}

// The parts of a project row and its findings.
function inspect(p, add) {
  const info = p.info;
  const pkgConfig = p.configs.packages?.data ?? null;
  const configs = [p.configs.web, p.configs.app].filter(Boolean);
  const name = p.name;
  if (!info) {
    return { kind: 'unknown', families: [], row: { style: 'unreadable', language: '-', outputType: '-', targets: [], kind: 'unknown', packageSource: '-', packages: [], frameworkOnly: [], windowsOnly: [] } };
  }
  const packageIds = (pkgConfig ?? []).map((x) => x.id);
  const services = configs.flatMap((c) => c.data.services);
  const kind = guessKind(info, p.files, packageIds, Boolean(p.configs.web), services.length);
  const families = info.targets.map((t) => t.family);
  const framework = info.targets.filter((t) => t.family === 'framework');
  const standard = info.targets.filter((t) => t.family === 'netstandard');
  const modern = info.targets.filter((t) => t.family === 'modern');
  const allNames = [...info.references, ...info.packageReferences.map((x) => x.id), ...packageIds, ...info.frameworkReferences];
  const frameworkOnly = [...new Set(info.references.filter((r) => nameMatches(FRAMEWORK_ONLY, r)))];
  const windowsOnly = [...new Set(allNames.filter((r) => nameMatches(WINDOWS_ONLY, r)))];
  if (info.useWindowsForms) windowsOnly.push('UseWindowsForms');
  if (info.useWpf) windowsOnly.push('UseWPF');
  for (const t of modern) if (t.platform === 'windows') windowsOnly.push(`${t.moniker} target`);

  if (info.style === 'old-style') {
    add('old-style-project', name, p.file, `${name} is an old-style project file (no Sdk attribute${info.toolsVersion ? `, ToolsVersion ${info.toolsVersion}` : ''}); modern .NET builds only SDK-style projects. Convert it to the SDK style first; the .NET Upgrade Assistant helps with this`);
  }
  if (pkgConfig) {
    add('packages-config', name, p.configs.packages.file, `${name} lists ${plural(pkgConfig.length, 'package')} in packages.config (${listOf(packageIds)}); SDK-style projects restore only PackageReference items. Move them into the project file as PackageReference`);
  }
  if (framework.length) {
    add('framework-target', name, p.file, `${name} targets .NET Framework ${listOf(framework.map((t) => t.version))} (${listOf(framework.map((t) => t.moniker))})`);
  }
  const pages = [];
  if (p.files.webForms) pages.push(plural(p.files.webForms, 'Web Forms page'));
  if (p.files.userControls) pages.push(plural(p.files.userControls, 'user control'));
  if (p.files.masterPages) pages.push(plural(p.files.masterPages, 'master page'));
  if (pages.length) {
    add('web-forms', name, p.file, `${name} has ${pages.join(', ')}; ASP.NET Core has no Web Forms and no direct equivalent. Rebuild these pages in Razor Pages, MVC or Blazor`);
  }
  if (p.files.wcf || services.length) {
    const parts = [];
    if (p.files.wcf) parts.push(plural(p.files.wcf, '.svc file'));
    if (services.length) parts.push(`${plural(services.length, 'service')} in ${configs.filter((c) => c.data.services.length).map((c) => c.file).join(', ')}`);
    add('wcf-service', name, p.file, `${name} hosts WCF services (${parts.join(', ')}); modern .NET has no WCF server. Move them to gRPC or REST on ASP.NET Core, or to CoreWCF`);
  }
  if (p.files.asmx) {
    add('asmx-service', name, p.file, `${name} has ${plural(p.files.asmx, 'ASMX web service')} (.asmx); ASP.NET Core does not run them. Rebuild them as ASP.NET Core APIs, or as SOAP services on CoreWCF`);
  }
  const systemWeb = frameworkOnly.filter((r) => nameMatches(['System.Web', 'System.Web.*'], r));
  if (systemWeb.length) {
    add('system-web', name, p.file, `${name} references ${listOf(systemWeb)}; System.Web is not available in ASP.NET Core. Code that uses HttpContext.Current, the session, the page model or HTTP modules has to be rewritten against ASP.NET Core`);
  }
  for (const c of configs) {
    const { httpModules, httpHandlers, bindingRedirects, clientEndpoints } = c.data;
    if (httpModules.length || httpHandlers.length) {
      const parts = [];
      if (httpModules.length) parts.push(`${plural(httpModules.length, 'HTTP module')} (${listOf(httpModules)})`);
      if (httpHandlers.length) parts.push(`${plural(httpHandlers.length, 'HTTP handler')} (${listOf(httpHandlers)})`);
      add('http-modules', name, c.file, `${c.file} registers ${parts.join(' and ')} for ${name}; ASP.NET Core has no modules or handlers. Rewrite them as middleware`);
    }
    if (bindingRedirects.length) {
      add('binding-redirects', name, c.file, `${c.file} has ${plural(bindingRedirects.length, 'assembly binding redirect')} (${listOf(bindingRedirects.map((b) => `${b.name} ${b.newVersion ?? '?'}`))}); modern .NET does not use binding redirects. Check that the package versions they unify still agree after the move`);
    }
    if (clientEndpoints.length) {
      add('wcf-client', name, c.file, `${c.file} configures ${plural(clientEndpoints.length, 'WCF client endpoint')} (${listOf(clientEndpoints)}); on modern .NET a WCF client uses the System.ServiceModel client packages and is configured in code, not in the config file`);
    }
  }
  if (windowsOnly.length) {
    add('windows-only', name, p.file, `${name} uses Windows-only APIs: ${listOf(windowsOnly)}; on modern .NET they run only on Windows, so the moved project stays on Windows unless they are replaced`);
  }
  if (standard.length) {
    add('netstandard-library', name, p.file, `${name} targets ${listOf(standard.map((t) => t.moniker))} and already runs on modern .NET; move it first or keep it as it is`);
  }
  if (modern.length) {
    add('sdk-ready', name, p.file, `${name} already targets modern .NET (${listOf(modern.map((t) => t.moniker))}); compare the version with the .NET support policy`);
  }

  const references = info.packageReferences.length ? info.packageReferences : [];
  return {
    kind,
    families,
    row: {
      style: info.style,
      language: info.language,
      outputType: info.outputType,
      targets: info.targets.map((t) => t.moniker),
      kind,
      packageSource: pkgConfig ? 'packages.config' : references.length ? 'PackageReference' : 'none',
      packages: (pkgConfig ?? references).map((x) => ({ id: x.id, version: x.version ?? null })),
      frameworkOnly,
      windowsOnly
    }
  };
}

// Checks a scan from scanPath.
//   options: limit (rows and findings shown), failOn (error or warning), sources
export function checkScan(scan, options = {}) {
  const o = { limit: DEFAULTS.limit, failOn: 'error', ...options };
  const show = (t) => safeText(t, 300);
  const all = [];
  const add = (id, project, file, message) => all.push({ id, severity: SEVERITY[id], project, file, message: safeText(message, 1200) });
  for (const p of scan.problems) add(p.id, p.project, p.file, p.message);

  const notes = [...scan.notes];
  const rows = [];
  const nodes = [];
  const names = new Map(scan.projects.map((p) => [p.id, p.name]));
  for (const p of scan.projects) {
    const { kind, families, row } = inspect(p, add);
    if (p.info) for (const n of p.info.notes) notes.push(`${p.file}: ${n}`);
    rows.push({
      name: show(p.name),
      file: show(p.file),
      solutionFolder: p.folder ? show(p.folder) : null,
      ...row,
      targets: row.targets.map(show),
      packages: row.packages.map((x) => ({ id: show(x.id), version: x.version === null ? null : show(x.version) })),
      projectReferences: p.refs.map((r) => show(names.get(r))),
      frameworkOnly: row.frameworkOnly.map(show),
      windowsOnly: row.windowsOnly.map(show),
      files: { ...p.files }
    });
    if (p.info) {
      const { group, rank } = moveGroup(kind, families);
      nodes.push({ id: p.id, name: p.name, group, rank, refs: p.refs });
    } else notes.push(`${p.file} could not be read and is left out of the move order`);
  }
  const { order, cycles } = moveOrder(nodes);
  const fileOf = new Map(scan.projects.map((p) => [p.name, p.file]));
  for (const loop of cycles) {
    add('reference-cycle', loop[0], fileOf.get(loop[0]) ?? null, `${[...loop, loop[0]].join(' -> ')}: these projects reference each other in a loop, so MSBuild cannot build them and there is no order to move them in. Break the loop first`);
  }

  const cmpText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  all.sort((a, b) => RANK[a.severity] - RANK[b.severity] || ORDER[a.id] - ORDER[b.id] || cmpText(a.file ?? '', b.file ?? '') || cmpText(a.message, b.message));
  const counts = { error: 0, warning: 0, info: 0 };
  const byCheck = Object.fromEntries(FINDINGS.map((f) => [f.id, 0]));
  for (const f of all) {
    counts[f.severity] += 1;
    byCheck[f.id] += 1;
  }
  const failing = all.filter((f) => meetsThreshold(f.severity, o.failOn));
  const errors = failing.filter((f) => f.severity === 'error').length;
  const warnings = failing.length - errors;
  const reason = [errors ? plural(errors, 'error') : '', warnings ? plural(warnings, 'warning') : ''].filter(Boolean).join(' and ');
  if (all.length > o.limit) notes.push(`showing the first ${plural(o.limit, 'finding')} of ${all.length.toLocaleString('en-US')}; raise --limit to see more`);
  if (rows.length > o.limit) notes.push(`showing the first ${o.limit.toLocaleString('en-US')} of ${rows.length.toLocaleString('en-US')} projects`);

  return {
    tool: 'dotnet-port-scan',
    input: show(o.input ?? scan.input),
    summary: {
      solutions: scan.solutions.length,
      projects: rows.length,
      oldStyle: rows.filter((r) => r.style === 'old-style').length,
      sdkStyle: rows.filter((r) => r.style === 'sdk').length,
      unreadable: rows.filter((r) => r.style === 'unreadable').length,
      files: { ...scan.totals }
    },
    solutions: scan.solutions.map(show),
    projects: rows.slice(0, o.limit),
    order: order.slice(0, o.limit).map(({ id, ...x }) => ({ ...x, name: show(x.name), after: x.after.map(show) })),
    cycles: cycles.map((c) => c.map(show)),
    counts,
    byCheck,
    total: all.length,
    limit: o.limit,
    findings: all.slice(0, o.limit).map((f) => ({ ...f, project: f.project === null ? null : show(f.project), file: f.file === null ? null : show(f.file) })),
    notes: notes.map((n) => safeText(n, 1200)),
    gate: { failOn: o.failOn, pass: failing.length === 0, reason: failing.length ? reason : '' }
  };
}
