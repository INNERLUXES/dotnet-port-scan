// Command line: dotnet-port-scan --path <folder or .sln> [options]

import { readFileSync } from 'node:fs';
import { scanPath, LIMITS } from './scan.js';
import { checkScan, FINDINGS, DEFAULTS } from './check.js';
import { toText, toMarkdown, toJson, toCsv } from './report.js';

export const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const FORMATS = { text: toText, markdown: toMarkdown, json: toJson, csv: toCsv };
const THRESHOLDS = ['error', 'warning'];

export const USAGE = `Usage: dotnet-port-scan --path <folder or .sln> [options]

Makes an inventory of a .NET Framework solution before it is moved to modern .NET: the style, target
framework and kind of every project, its packages and references, Web Forms, WCF and ASMX files, web.config
modules and handlers, and a suggested move order. It reads files only; it never runs dotnet, msbuild or
nuget and opens no connection.

Options:
  --path <path>       the folder of the solution, or its .sln file
  --format <name>     text, markdown, json or csv (default: text)
  --fail-on <level>   exit with 1 when a finding is at this level or above: error or warning
                      (default: error)
  --limit <n>         show at most n findings, projects and steps (default: ${DEFAULTS.limit}); the total is
                      always shown
  --help              show this text
  --version           show the version

Checks: ${FINDINGS.map((f) => f.id).join(', ')}

Exit codes: 0 no finding at the --fail-on level, 1 such a finding, 2 usage or input error.
`;

function count(value, option, max) {
  if (!/^\d{1,7}$/.test(value) || Number(value) < 1 || Number(value) > max) throw new Error(`${option} takes a whole number from 1 to ${max.toLocaleString('en-US')}, not ${value}`);
  return Number(value);
}

export function parseArgs(argv) {
  const o = { path: null, format: 'text', failOn: 'error', limit: DEFAULTS.limit, help: false, version: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      i += 1;
      return v;
    };
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--version' || a === '-v') o.version = true;
    else if (a === '--path') {
      if (o.path !== null) throw new Error('give one --path');
      o.path = next();
    } else if (a === '--format') o.format = next();
    else if (a === '--fail-on') o.failOn = next();
    else if (a === '--limit') o.limit = count(next(), '--limit', 1_000_000);
    else if (a === '-') throw new Error('reading from standard input is not supported; give a folder or a .sln file');
    else if (a.startsWith('-')) throw new Error(`unknown argument ${a}`);
    else if (o.path === null) o.path = a;
    else throw new Error(`give one folder or .sln file, not also ${a}`);
  }
  if (!o.help && !o.version) {
    if (o.path === null) throw new Error('give the folder of the solution, or its .sln file, with --path');
    if (!Object.hasOwn(FORMATS, o.format)) throw new Error(`unknown format ${o.format} (text, markdown, json or csv)`);
    if (!THRESHOLDS.includes(o.failOn)) throw new Error(`--fail-on takes error or warning, not ${o.failOn}`);
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(o.path)) throw new Error('give a local folder or .sln file; the tool never fetches a URL');
  }
  return o;
}

// Exit code: 0 no finding at the --fail-on level, 1 such a finding, 2 usage or input error.
export async function main(argv, io = { out: (t) => process.stdout.write(t), err: (t) => process.stderr.write(t) }, limits = LIMITS) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (error) {
    io.err(`dotnet-port-scan: ${error.message}\n\n${USAGE}`);
    return 2;
  }
  if (o.help) {
    io.out(USAGE);
    return 0;
  }
  if (o.version) {
    io.out(`${VERSION}\n`);
    return 0;
  }
  let report;
  try {
    report = checkScan(await scanPath(o.path, limits), { limit: o.limit, failOn: o.failOn });
  } catch (error) {
    io.err(`dotnet-port-scan: ${String(error.message).replace(/[\u0000-\u001f\u007f-\u009f\u200E\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069]/g, ' ')}\n`);
    return 2;
  }
  io.out(FORMATS[o.format](report));
  return report.gate.pass ? 0 : 1;
}
