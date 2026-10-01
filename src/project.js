// Reads an MSBuild project file (.csproj, .vbproj, .fsproj), old-style or SDK-style, and returns what a move
// to modern .NET needs to know: the style, the target frameworks, the output type, the package, project and
// assembly references, and the switches for Windows desktop and test projects. MSBuild itself is never run:
// properties are read as written, and a value that MSBuild would compute ("$(...)") is named in a note.
// Element names are compared ignoring case, as MSBuild does for property and item names.

import { parseXml, childElements, findElements, attr, textOf, localName } from './xml.js';
import { toSlash } from './sln.js';

export const LANGUAGES = { '.csproj': 'C#', '.vbproj': 'VB.NET', '.fsproj': 'F#' };

// Project type ids written in ProjectTypeGuids of old-style projects.
export const PROJECT_TYPES = {
  webApplication: '349C5851-65DF-11DA-9384-00065B846F21',
  webSite: 'E24C65DC-7377-472B-9ABA-BC803B73C61A',
  mvc: ['F85E285D-A4E0-4152-9332-AB1D724D3325', 'E53F8FEA-EAE0-44A6-8774-FFD645390401', 'E3E379DF-F4C6-4180-9B81-6769533ABE47'],
  wcf: '3D9AD99F-2412-4246-B90B-4EAA41C64699',
  wpf: '60DC8134-EBA5-43B8-BCC9-BB4BC16C2548',
  test: '3AC096D0-A1C2-E12C-1390-A8335801FDAB'
};

// Assemblies of .NET Framework with no counterpart in modern .NET. A name ending in ".*" covers the name and
// every name below it.
export const FRAMEWORK_ONLY = [
  'System.Web', 'System.Web.*', 'System.EnterpriseServices', 'System.Messaging', 'System.Runtime.Remoting',
  'System.ServiceModel.Activation', 'System.ServiceModel.Activities', 'System.Workflow.*', 'System.Activities',
  'System.Activities.*', 'System.Data.OracleClient', 'System.IdentityModel.Services', 'System.Deployment',
  'System.Management.Instrumentation'
];

// Assemblies and packages whose APIs run on modern .NET only on Windows.
export const WINDOWS_ONLY = [
  'System.Drawing', 'System.Drawing.*', 'System.Management', 'System.DirectoryServices', 'System.DirectoryServices.*',
  'System.ServiceProcess', 'System.ServiceProcess.*', 'System.Windows.Forms', 'System.Windows.Forms.*',
  'PresentationFramework', 'PresentationFramework.*', 'PresentationCore', 'WindowsBase', 'System.Xaml',
  'Microsoft.Win32.Registry', 'Microsoft.Win32.Registry.*', 'System.Diagnostics.EventLog',
  'System.Diagnostics.PerformanceCounter', 'Microsoft.WindowsDesktop.App', 'Microsoft.WindowsDesktop.App.*'
];

const TEST_PACKAGES = ['Microsoft.NET.Test.Sdk', 'xunit', 'xunit.*', 'NUnit', 'NUnit.*', 'MSTest.TestFramework', 'MSTest', 'MSTest.*'];

// True when the assembly or package name is in the list, ignoring case.
export function nameMatches(list, name) {
  const n = String(name).toLowerCase();
  return list.some((entry) => {
    const e = entry.toLowerCase();
    return e.endsWith('.*') ? n === e.slice(0, -2) || n.startsWith(e.slice(0, -1)) : n === e;
  });
}

// What a target framework moniker means:
//   family: framework (.NET Framework), netstandard, modern (.NET Core and .NET 5 or later) or unknown
//   version: "4.7.2", "2.0", "8.0"; platform: "windows" for net8.0-windows
export function frameworkOf(moniker) {
  const raw = String(moniker).trim();
  const t = raw.toLowerCase();
  let m = /^v([1-4])\.(\d)(?:\.(\d))?$/.exec(t);
  if (m) return { moniker: raw, family: 'framework', version: [m[1], m[2], m[3]].filter(Boolean).join('.'), platform: null };
  m = /^net([1-4])(\d)(\d)?$/.exec(t);
  if (m) return { moniker: raw, family: 'framework', version: [m[1], m[2], m[3]].filter(Boolean).join('.'), platform: null };
  m = /^netstandard(\d{1,2}\.\d{1,2})$/.exec(t);
  if (m) return { moniker: raw, family: 'netstandard', version: m[1], platform: null };
  m = /^netcoreapp(\d{1,2}\.\d{1,2})$/.exec(t);
  if (m) return { moniker: raw, family: 'modern', version: m[1], platform: null };
  m = /^net(\d{1,2})\.(\d{1,2})(?:-([a-z]{1,20})[0-9.]*)?$/.exec(t);
  if (m && Number(m[1]) >= 5) return { moniker: raw, family: 'modern', version: `${m[1]}.${m[2]}`, platform: m[3] ?? null };
  return { moniker: raw, family: 'unknown', version: null, platform: null };
}

function extensionOf(file) {
  const m = /(\.[A-Za-z]+)$/.exec(String(file));
  return m ? m[1].toLowerCase() : '';
}

function baseName(file) {
  const parts = toSlash(file).split('/');
  return parts[parts.length - 1].replace(/\.[A-Za-z]+$/, '');
}

const isTarget = (e) => localName(e.name) === 'target';
const includes = (e) => (attr(e, 'Include') ?? '').split(';').map((s) => s.trim()).filter(Boolean);

// Reads the text of a project file. Throws when it is not well-formed XML or not an MSBuild project.
export function parseProject(text, file = 'project') {
  const root = parseXml(text, file);
  if (localName(root.name) !== 'project') throw new Error(`${file}: the root element is <${root.name.slice(0, 40)}>, not <Project>`);
  const notes = [];
  const sdk = attr(root, 'Sdk')
    ?? childElements(root, 'Sdk').map((e) => attr(e, 'Name')).find(Boolean)
    ?? findElements(root, 'Import', isTarget).map((e) => attr(e, 'Sdk')).find(Boolean)
    ?? null;

  // Properties: an unconditional value replaces any earlier one (the last one wins, as in MSBuild); a value
  // under a Condition is used only when nothing else sets the property.
  const props = new Map();
  for (const group of findElements(root, 'PropertyGroup', isTarget)) {
    const groupConditional = attr(group, 'Condition') !== null;
    for (const p of group.children) {
      const key = localName(p.name);
      const conditional = groupConditional || attr(p, 'Condition') !== null;
      const prev = props.get(key);
      if (!conditional || !prev) props.set(key, { value: textOf(p), conditional });
    }
  }
  const prop = (name) => props.get(name.toLowerCase())?.value ?? null;
  const computed = (name, value) => {
    if (value !== null && value.includes('$(')) {
      notes.push(`${name} is "${value.slice(0, 80)}", which MSBuild computes; the tool does not evaluate it`);
      return null;
    }
    return value;
  };

  const many = computed('TargetFrameworks', prop('TargetFrameworks'));
  const one = computed('TargetFramework', prop('TargetFramework'));
  const version = computed('TargetFrameworkVersion', prop('TargetFrameworkVersion'));
  let monikers = [];
  if (many) monikers = many.split(';').map((s) => s.trim()).filter(Boolean);
  else if (one) monikers = [one];
  else if (version) monikers = [version];
  for (const name of ['TargetFrameworks', 'TargetFramework', 'TargetFrameworkVersion']) {
    if (props.get(name.toLowerCase())?.conditional && monikers.length) notes.push(`${name} is set only under a Condition; the first value was used`);
  }
  if (!monikers.length) notes.push(sdk ? 'no target framework in the project file; it may come from Directory.Build.props, which is not read' : 'no TargetFrameworkVersion in the project file');
  const targets = monikers.map(frameworkOf);

  const items = findElements(root, 'ItemGroup', isTarget).flatMap((g) => g.children);
  const itemsOf = (name) => items.filter((e) => localName(e.name) === name.toLowerCase());
  const packageReferences = itemsOf('PackageReference').flatMap((e) => {
    const v = attr(e, 'Version') ?? childElements(e, 'Version').map(textOf)[0] ?? null;
    return includes(e).map((id) => ({ id, version: v }));
  });
  const projectReferences = itemsOf('ProjectReference').flatMap((e) => includes(e).map(toSlash));
  const references = itemsOf('Reference').flatMap((e) => includes(e).map((r) => r.split(',')[0].trim())).filter(Boolean);
  const frameworkReferences = itemsOf('FrameworkReference').flatMap(includes);
  const imports = findElements(root, 'Import', isTarget).map((e) => attr(e, 'Project')).filter(Boolean).map(toSlash);
  const guids = (prop('ProjectTypeGuids') ?? '').split(';').map((g) => g.trim().replace(/^\{|\}$/g, '').toUpperCase()).filter(Boolean);
  const truthy = (name) => (prop(name) ?? '').toLowerCase() === 'true';
  const output = (prop('OutputType') ?? 'Library').toLowerCase();

  return {
    file,
    name: baseName(file),
    language: LANGUAGES[extensionOf(file)] ?? 'unknown',
    style: sdk ? 'sdk' : 'old-style',
    sdk,
    toolsVersion: attr(root, 'ToolsVersion'),
    outputType: { exe: 'Exe', winexe: 'WinExe', library: 'Library', module: 'Module' }[output] ?? (prop('OutputType') || 'Library'),
    assemblyName: prop('AssemblyName'),
    targets,
    projectTypeGuids: guids,
    packageReferences,
    projectReferences,
    references,
    frameworkReferences,
    imports,
    useWindowsForms: truthy('UseWindowsForms'),
    useWpf: truthy('UseWPF'),
    isTestProject: truthy('IsTestProject'),
    notes
  };
}

const ZERO = { webForms: 0, userControls: 0, masterPages: 0, globalAsax: 0, wcf: 0, asmx: 0, razor: 0, code: 0 };

// A guess at what kind of application the project is, from its SDK, its project type ids, its references
// and packages, and the files in its folder (counts from scan.js) and its web.config.
//   project   the result of parseProject
//   files     counts of files by kind in the project folder
//   packages  ids from packages.config
//   web       true when the folder has a web.config
//   services  the number of WCF services in its web.config or app.config
export function guessKind(project, files = ZERO, packages = [], web = false, services = 0) {
  const f = { ...ZERO, ...files };
  const names = [...project.references, ...project.packageReferences.map((p) => p.id), ...packages, ...project.frameworkReferences];
  const has = (list) => names.some((n) => nameMatches(list, n));
  const guids = project.projectTypeGuids;
  const sdk = (project.sdk ?? '').toLowerCase();
  const output = project.outputType.toLowerCase();
  const webProject = sdk.startsWith('microsoft.net.sdk.web') || guids.includes(PROJECT_TYPES.webApplication) || guids.includes(PROJECT_TYPES.webSite)
    || PROJECT_TYPES.mvc.some((g) => guids.includes(g)) || project.imports.some((i) => /WebApplications\/Microsoft\.WebApplication\.targets$/i.test(i)) || (web && output === 'library' && has(['System.Web']));
  if (project.isTestProject || guids.includes(PROJECT_TYPES.test) || has(TEST_PACKAGES)) return 'test';
  if (sdk.startsWith('microsoft.net.sdk.web')) return 'ASP.NET Core web';
  if (f.wcf > 0 || services > 0 || guids.includes(PROJECT_TYPES.wcf)) return 'WCF service';
  if (f.webForms + f.userControls + f.masterPages > 0) return 'Web Forms';
  if (has(['System.Web.Mvc', 'Microsoft.AspNet.Mvc']) || PROJECT_TYPES.mvc.some((g) => guids.includes(g)) || (webProject && f.razor > 0)) return 'MVC';
  if (has(['System.Web.Http', 'System.Web.Http.*', 'Microsoft.AspNet.WebApi', 'Microsoft.AspNet.WebApi.*'])) return 'Web API';
  if (f.asmx > 0) return 'ASMX web service';
  if (webProject) return 'web application';
  if (has(['System.ServiceProcess']) && (output === 'exe' || output === 'winexe')) return 'Windows service';
  if (project.useWpf || guids.includes(PROJECT_TYPES.wpf) || has(['PresentationFramework'])) return 'desktop (WPF)';
  if (project.useWindowsForms || (has(['System.Windows.Forms']) && output === 'winexe')) return 'desktop (WinForms)';
  if (output === 'exe') return 'console';
  if (output === 'winexe') return 'desktop';
  return 'class library';
}
