// Reads a Visual Studio solution file (.sln): the header, every Project(...) entry with its type, name, path
// and id, and the NestedProjects section that puts projects into solution folders. Paths in a solution are
// written with Windows backslashes; they are returned with forward slashes so they resolve the same way on
// every system. Nothing in the file is run or followed here; scan.js decides which paths are read.

export const SOLUTION_FOLDER = '2150E333-8FDC-42A3-9474-1A3956D46DE8';
export const WEB_SITE = 'E24C65DC-7377-472B-9ABA-BC803B73C61A';
export const PROJECT_EXTENSIONS = ['.csproj', '.vbproj', '.fsproj'];

const HEADER = /^Microsoft Visual Studio Solution File, Format Version (\d{1,3}\.\d{1,3})$/;
const ENTRY = /^Project\("\{([0-9A-Fa-f-]{36})\}"\)\s*=\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*"\{([0-9A-Fa-f-]{36})\}"$/;
const NESTED = /^\{([0-9A-Fa-f-]{36})\}\s*=\s*\{([0-9A-Fa-f-]{36})\}$/;

// Backslashes to forward slashes; "./" at the start removed, and repeated slashes inside a path made one
// (a network path keeps its two leading slashes, and an address keeps the two after its scheme).
export function toSlash(path) {
  return String(path).replace(/\\/g, '/').replace(/([^:/])\/{2,}/g, '$1/').replace(/^(?:\.\/)+/, '');
}

export function isProjectPath(path) {
  const p = String(path).toLowerCase();
  return PROJECT_EXTENSIONS.some((e) => p.endsWith(e));
}

// Parses the text of a .sln file. Throws when the text is not a solution file.
//   { formatVersion, projects: [{ name, path, type, id, line, folder }], folders: [{ name, id, line }],
//     others: [{ name, path, type, line }] }
export function parseSln(text, label = 'solution', maxProjects = 5_000) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  let first = 0;
  while (first < lines.length && lines[first].trim() === '') first += 1;
  const head = HEADER.exec((lines[first] ?? '').trim());
  if (!head) throw new Error(`${label}: not a Visual Studio solution file (the first line is not "Microsoft Visual Studio Solution File, Format Version ...")`);
  const projects = [];
  const folders = [];
  const others = [];
  const parent = new Map();
  let inNested = false;
  for (let i = first + 1; i < lines.length; i += 1) {
    const row = lines[i].trim();
    if (row.startsWith('Project(')) {
      const m = ENTRY.exec(row);
      if (!m) throw new Error(`${label}: line ${i + 1}: a Project entry that cannot be read`);
      const entry = { name: m[2], path: toSlash(m[3]), type: m[1].toUpperCase(), id: m[4].toUpperCase(), line: i + 1 };
      if (entry.type === SOLUTION_FOLDER) folders.push({ name: entry.name, id: entry.id, line: entry.line });
      else if (isProjectPath(entry.path) && entry.type !== WEB_SITE) projects.push(entry);
      else others.push({ name: entry.name, path: entry.path, type: entry.type, line: entry.line });
      if (projects.length > maxProjects) throw new Error(`${label}: more than ${maxProjects.toLocaleString('en-US')} projects`);
      continue;
    }
    if (/^GlobalSection\(NestedProjects\)/.test(row)) {
      inNested = true;
      continue;
    }
    if (row === 'EndGlobalSection') {
      inNested = false;
      continue;
    }
    if (inNested) {
      const m = NESTED.exec(row);
      if (m) parent.set(m[1].toUpperCase(), m[2].toUpperCase());
    }
  }
  const folderName = new Map(folders.map((f) => [f.id, f.name]));
  // The chain of solution folders above an entry, outermost first; a loop in the section stops the chain.
  const chain = (id) => {
    const names = [];
    const seen = new Set();
    let at = parent.get(id);
    while (at && folderName.has(at) && !seen.has(at) && names.length < 32) {
      seen.add(at);
      names.unshift(folderName.get(at));
      at = parent.get(at);
    }
    return names.join('/');
  };
  for (const p of projects) p.folder = chain(p.id);
  return { formatVersion: head[1], projects, folders, others };
}
