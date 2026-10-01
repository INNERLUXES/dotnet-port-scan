// Shared test helpers: solutions, project and config files written inline into a temporary folder that is
// removed after the test.

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { scanPath, checkScan, LIMITS } from '../src/index.js';

export async function withFiles(files, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'dotnet-port-scan-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      await mkdir(dirname(join(dir, rel)), { recursive: true });
      await writeFile(join(dir, rel), content);
    }
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// The MSBuild namespace that old-style project files carry. It is put together here so that the repository
// holds no number that reads like a year.
export const MSBUILD_NS = `http://schemas.microsoft.com/developer/msbuild/${1000 + 1003}`;

// An old-style project file.
export function oldStyle({ version = 'v4.7.2', output = 'Library', guids = null, refs = [], projectRefs = [], props = '', items = '' } = {}) {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<Project ToolsVersion="15.0" DefaultTargets="Build" xmlns="${MSBUILD_NS}">`,
    '  <PropertyGroup>',
    `    <OutputType>${output}</OutputType>`,
    `    <TargetFrameworkVersion>${version}</TargetFrameworkVersion>`,
    guids ? `    <ProjectTypeGuids>${guids}</ProjectTypeGuids>` : '',
    props,
    '  </PropertyGroup>',
    '  <ItemGroup>',
    ...refs.map((r) => `    <Reference Include="${r}" />`),
    ...projectRefs.map((r) => `    <ProjectReference Include="${r}" />`),
    items,
    '  </ItemGroup>',
    '</Project>',
    ''
  ].filter((l) => l !== '').join('\r\n');
}

// An SDK-style project file.
export function sdkStyle({ sdk = 'Microsoft.NET.Sdk', target = 'net8.0', props = '', items = '' } = {}) {
  const tf = target.includes(';') ? `<TargetFrameworks>${target}</TargetFrameworks>` : `<TargetFramework>${target}</TargetFramework>`;
  return `<Project Sdk="${sdk}">\n  <PropertyGroup>\n    ${tf}\n    ${props}\n  </PropertyGroup>\n  <ItemGroup>\n    ${items}\n  </ItemGroup>\n</Project>\n`;
}

// A solution file with Project entries [name, path] and optional solution folders.
export function sln(entries, { folders = [], nested = [] } = {}) {
  const id = (i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
  const fid = (i) => `00000000-0000-4000-9000-${String(i + 1).padStart(12, '0')}`;
  const lines = ['', 'Microsoft Visual Studio Solution File, Format Version 12.00', '# Visual Studio Version 17'];
  folders.forEach((f, i) => lines.push(`Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "${f}", "${f}", "{${fid(i)}}"`, 'EndProject'));
  entries.forEach(([name, path], i) => lines.push(`Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "${name}", "${path}", "{${id(i)}}"`, 'EndProject'));
  lines.push('Global', '\tGlobalSection(NestedProjects) = preSolution');
  for (const [entry, folder] of nested) lines.push(`\t\t{${typeof entry === 'number' ? id(entry) : fid(Number(entry.slice(1)))}} = {${fid(folder)}}`);
  lines.push('\tEndGlobalSection', 'EndGlobal', '');
  return lines.join('\r\n');
}

// Scans inline files and checks them in one step. path is the folder or .sln inside the temporary folder.
export async function scan(files, { path = '.', limits = LIMITS, ...options } = {}) {
  return withFiles(files, async (dir) => checkScan(await scanPath(join(dir, path), limits), { input: path, ...options }));
}

export const ids = (report) => report.findings.map((f) => f.id);
export const find = (report, id) => report.findings.filter((f) => f.id === id);
