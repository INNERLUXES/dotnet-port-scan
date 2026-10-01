// Walks the folder of a .NET solution and reads its files: the .sln files, every project file they name
// (or every project file in the folder), and the packages.config, web.config and app.config next to each
// project. It counts the files that matter for a move to modern .NET by kind. It reads only inside the
// folder it was given: paths are resolved and checked against that folder, and links (symbolic links and
// junctions) that lead outside it are never followed. Build output and package folders are skipped.

import { readFile, stat, lstat, readdir, realpath } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute, join, sep } from 'node:path';
import { parseSln, toSlash, isProjectPath } from './sln.js';
import { parseProject } from './project.js';
import { parsePackagesConfig, parseWebConfig } from './config.js';

export const LIMITS = {
  maxFileBytes: 20 * 1024 * 1024,
  maxProjects: 5_000,
  maxFiles: 500_000,
  maxDepth: 64
};

export const SKIP_FOLDERS = ['bin', 'obj', 'packages', 'node_modules', '.git', '.vs'];
const SKIP = new Set(SKIP_FOLDERS);

const KINDS = {
  '.aspx': 'webForms', '.ascx': 'userControls', '.master': 'masterPages', '.svc': 'wcf', '.asmx': 'asmx',
  '.cshtml': 'razor', '.vbhtml': 'razor', '.cs': 'code', '.vb': 'code', '.fs': 'code'
};

export function emptyCounts() {
  return { webForms: 0, userControls: 0, masterPages: 0, globalAsax: 0, wcf: 0, asmx: 0, razor: 0, code: 0 };
}

// The kind of a file by its name, ignoring case, or null when it is not counted.
export function fileKind(name) {
  const n = String(name).toLowerCase();
  if (n === 'global.asax') return 'globalAsax';
  const dot = n.lastIndexOf('.');
  return dot > 0 && Object.hasOwn(KINDS, n.slice(dot)) ? KINDS[n.slice(dot)] : null;
}

function mb(bytes) {
  return `${bytes / 1024 / 1024} MB`;
}

// True when target is root or lies below it. Both must be absolute paths of this system.
export function isInside(root, target) {
  const r = relative(root, target);
  return r === '' || (r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r));
}

// A drive path (C:\...) or a network path (\\server\share\...), as Windows writes them.
export function isWindowsAbsolute(path) {
  return /^[A-Za-z]:[\\/]/.test(path) || /^[\\/]{2}[^\\/]/.test(path);
}

// Resolves a path written in a solution or project file against the folder of that file. Backslashes are
// read as separators on every system. A Windows drive or network path cannot name a file on Linux or macOS
// and gives null there; on Windows it is resolved like any other absolute path.
export function resolveWritten(baseDir, written) {
  const raw = String(written).trim();
  if (isWindowsAbsolute(raw) && sep === '/') return null;
  return resolve(baseDir, toSlash(raw));
}

// Reads a file as text within the size limit. UTF-8 with or without a byte order mark, and UTF-16 with one.
export async function readBounded(path, limits = LIMITS, label = path) {
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`${label}: not a file`);
  if (info.size > limits.maxFileBytes) throw new Error(`${label}: ${info.size.toLocaleString('en-US')} bytes is over the ${mb(limits.maxFileBytes)} limit`);
  const bytes = await readFile(path);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString('utf16le');
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Buffer.from(bytes.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  return bytes.toString('utf8').replace(/^\uFEFF/, '');
}

// Finds a file below root by its path, comparing each part of the path ignoring case, as Windows does.
// Returns { path, caseDiffers } with the path as it is on disk, or null.
export async function findIgnoringCase(root, target, cache = new Map()) {
  if (!isInside(root, target)) return null;
  const parts = relative(root, target).split(sep).filter(Boolean);
  let current = root;
  let caseDiffers = false;
  for (const part of parts) {
    let names = cache.get(current);
    if (!names) {
      try {
        names = await readdir(current);
      } catch {
        return null;
      }
      cache.set(current, names);
    }
    let hit = names.find((n) => n === part);
    if (hit === undefined) {
      hit = names.find((n) => n.toLowerCase() === part.toLowerCase());
      if (hit === undefined) return null;
      caseDiffers = true;
    }
    current = join(current, hit);
  }
  try {
    await lstat(current);
  } catch {
    return null;
  }
  return { path: current, caseDiffers };
}

function describe(error, label) {
  if (error.code === 'ENOENT') return `${label}: no such file`;
  if (error.code) return `${label}: could not be read (${error.code})`;
  return error.message;
}

// Walks the folder. Returns the folders with their counts and config files, the project files and the
// solution files, in a stable order.
async function walk(root, limits, notes, rel) {
  const dirs = new Map();
  const projects = [];
  const solutions = [];
  let files = 0;
  const stack = [[root, 0]];
  while (stack.length) {
    const [dir, depth] = stack.pop();
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      notes.push(`${rel(dir)}: the folder could not be read (${error.code ?? 'error'})`);
      continue;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const here = { dir, counts: emptyCounts(), configs: {} };
    dirs.set(dir.toLowerCase(), here);
    const subdirs = [];
    for (const entry of entries) {
      let full = join(dir, entry.name);
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        let real;
        try {
          real = await realpath(full);
        } catch {
          notes.push(`${rel(full)}: a link whose target does not exist; skipped`);
          continue;
        }
        if (!isInside(root, real)) {
          notes.push(`${rel(full)}: a link that leads outside the folder; not followed`);
          continue;
        }
        const info = await stat(real);
        if (info.isDirectory()) {
          notes.push(`${rel(full)}: a link to a folder; not followed, so nothing is counted twice`);
          continue;
        }
        isDir = false;
        isFile = info.isFile();
        full = real;
      }
      if (isDir) {
        if (SKIP.has(entry.name.toLowerCase())) continue;
        if (depth + 1 > limits.maxDepth) throw new Error(`${rel(full)}: folders nested more than ${limits.maxDepth} deep`);
        subdirs.push(full);
        continue;
      }
      if (!isFile) continue;
      files += 1;
      if (files > limits.maxFiles) throw new Error(`more than ${limits.maxFiles.toLocaleString('en-US')} files in the folder; give a smaller folder or the .sln file of one solution`);
      const lower = entry.name.toLowerCase();
      if (isProjectPath(lower)) {
        projects.push(full);
        if (projects.length > limits.maxProjects) throw new Error(`more than ${limits.maxProjects.toLocaleString('en-US')} project files in the folder`);
      } else if (lower.endsWith('.sln')) solutions.push(full);
      if (lower === 'web.config' || lower === 'app.config' || lower === 'packages.config') here.configs[lower] = full;
      const kind = fileKind(entry.name);
      if (kind) here.counts[kind] += 1;
    }
    for (let k = subdirs.length - 1; k >= 0; k -= 1) stack.push([subdirs[k], depth + 1]);
  }
  return { dirs, projects, solutions, files };
}

const CONFIGS = [
  ['packages.config', 'packages', parsePackagesConfig],
  ['web.config', 'web', parseWebConfig],
  ['app.config', 'app', parseWebConfig]
];

// Scans a folder or a .sln file. Throws on an input error (no such path, a .sln that is not a solution, a
// limit). Problems with single files inside the scan are returned as missing-project and unreadable.
//   { input, solutions, projects, problems, notes, totals, files }
export async function scanPath(input, limits = LIMITS) {
  const display = toSlash(input);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) throw new Error('give a local folder or .sln file; the tool never fetches a URL');
  let info;
  try {
    info = await stat(input);
  } catch (error) {
    throw new Error(error.code === 'ENOENT' ? `${display}: no such file or folder` : describe(error, display));
  }
  let root;
  let solutionGiven = null;
  if (info.isDirectory()) root = await realpath(input);
  else if (info.isFile() && /\.sln$/i.test(input)) {
    solutionGiven = await realpath(input);
    root = dirname(solutionGiven);
  } else throw new Error(`${display}: give a folder or a .sln file`);

  const notes = [];
  const problems = [];
  const rel = (p) => toSlash(relative(root, p)) || '.';
  const { dirs, projects: found, solutions: foundSolutions, files } = await walk(root, limits, notes, rel);
  const solutions = solutionGiven ? [solutionGiven] : foundSolutions;
  const cache = new Map();
  const entries = new Map();
  const problem = (id, file, project, message) => problems.push({ id, file, project, message });

  for (const sln of solutions) {
    const slnFile = rel(sln);
    let parsed;
    try {
      parsed = parseSln(await readBounded(sln, limits, slnFile), slnFile, limits.maxProjects);
    } catch (error) {
      if (sln === solutionGiven) throw new Error(describe(error, slnFile));
      problem('unreadable', slnFile, null, describe(error, slnFile));
      continue;
    }
    for (const o of parsed.others) notes.push(`${slnFile}: line ${o.line}: "${o.name}" (${o.path}) is not a C#, VB.NET or F# project file and was not read`);
    for (const p of parsed.projects) {
      const where = `${slnFile}: line ${p.line}`;
      const abs = resolveWritten(dirname(sln), p.path);
      if (abs === null || !isInside(root, abs)) {
        problem('unreadable', slnFile, p.name, `${where}: the project "${p.name}" at ${p.path} lies outside the folder of the solution and was not read`);
        continue;
      }
      const hit = await findIgnoringCase(root, abs, cache);
      if (!hit) {
        problem('missing-project', slnFile, p.name, `${where}: the solution lists "${p.name}" at ${p.path}, but there is no such file`);
        continue;
      }
      if (hit.caseDiffers) notes.push(`${where}: ${p.path} is written with other letter case than the file on disk (${rel(hit.path)}); Windows ignores the difference, Linux and macOS do not`);
      const real = await realpath(hit.path);
      if (!isInside(root, real)) {
        problem('unreadable', slnFile, p.name, `${where}: the project "${p.name}" at ${p.path} is a link that leads outside the folder and was not read`);
        continue;
      }
      const key = real.toLowerCase();
      if (!entries.has(key)) entries.set(key, { abs: real, name: p.name, solution: slnFile, folder: p.folder });
      if (entries.size > limits.maxProjects) throw new Error(`more than ${limits.maxProjects.toLocaleString('en-US')} projects`);
    }
  }
  if (solutionGiven) {
    const extra = found.filter((f) => !entries.has(f.toLowerCase()));
    if (extra.length) notes.push(`${extra.length.toLocaleString('en-US')} project file(s) in the folder are not in the solution and were not read: ${extra.slice(0, 5).map(rel).join(', ')}${extra.length > 5 ? ', ...' : ''}`);
  } else {
    for (const f of found) if (!entries.has(f.toLowerCase())) entries.set(f.toLowerCase(), { abs: f, name: null, solution: null, folder: '' });
  }

  const projects = [];
  for (const e of entries.values()) {
    const file = rel(e.abs);
    const dir = dirname(e.abs);
    const stem = file.split('/').pop().replace(/\.[A-Za-z]+$/, '');
    const record = { id: projects.length, name: e.name ?? stem, file, abs: e.abs, dir, solution: e.solution, folder: e.folder, info: null, files: emptyCounts(), configs: { packages: null, web: null, app: null }, refs: [] };
    try {
      record.info = parseProject(await readBounded(e.abs, limits, file), file);
    } catch (error) {
      problem('unreadable', file, record.name, describe(error, file));
    }
    const here = dirs.get(dir.toLowerCase())?.configs ?? {};
    for (const [name, slot, parse] of CONFIGS) {
      if (!here[name]) continue;
      const configFile = rel(here[name]);
      try {
        record.configs[slot] = { file: configFile, data: parse(await readBounded(here[name], limits, configFile), configFile) };
      } catch (error) {
        problem('unreadable', configFile, record.name, describe(error, configFile));
      }
    }
    projects.push(record);
  }

  // Files are counted for the project in the nearest folder above them.
  const owners = new Map();
  for (const p of projects) {
    const key = p.dir.toLowerCase();
    if (!owners.has(key)) owners.set(key, p);
    else notes.push(`${p.file} shares its folder with ${owners.get(key).file}; the files there are counted for ${owners.get(key).name}`);
  }
  const totals = emptyCounts();
  const rootKey = root.toLowerCase();
  for (const [key, d] of dirs) {
    let owner = null;
    for (let at = key; ; at = dirname(at)) {
      if (owners.has(at)) {
        owner = owners.get(at);
        break;
      }
      if (at === rootKey || dirname(at) === at) break;
    }
    for (const k of Object.keys(totals)) {
      totals[k] += d.counts[k];
      if (owner) owner.files[k] += d.counts[k];
    }
  }

  // Project references, matched to the projects of the scan by path, ignoring case.
  const byPath = new Map(projects.map((p) => [p.abs.toLowerCase(), p]));
  for (const p of projects) {
    if (!p.info) continue;
    for (const written of p.info.projectReferences) {
      const abs = resolveWritten(p.dir, written);
      if (abs === null || !isInside(root, abs)) {
        notes.push(`${p.file}: the project reference ${written} lies outside the folder and was not followed`);
        continue;
      }
      let target = byPath.get(abs.toLowerCase());
      let caseDiffers = target ? target.abs !== abs : false;
      if (!target) {
        const hit = await findIgnoringCase(root, abs, cache);
        if (!hit) {
          problem('missing-project', p.file, p.name, `${p.name} references ${written}, but there is no such file`);
          continue;
        }
        target = byPath.get((await realpath(hit.path)).toLowerCase());
        caseDiffers = hit.caseDiffers;
        if (!target) {
          notes.push(`${p.file}: the project reference ${written} is not part of the scan (${solutionGiven ? 'not in the solution' : 'in a skipped folder'})`);
          continue;
        }
      }
      if (caseDiffers) notes.push(`${p.file}: the project reference ${written} is written with other letter case than the file on disk (${target.file}); Windows ignores the difference, Linux and macOS do not`);
      if (!p.refs.includes(target.id)) p.refs.push(target.id);
    }
  }

  return { input: display, solutions: solutions.map(rel), projects, problems, notes, totals, files };
}
