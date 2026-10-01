import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parseArgs, main, toText, toMarkdown, toJson, toCsv, csvCell, mdCell, USAGE, VERSION, LIMITS } from '../src/index.js';
import { scan, withFiles, oldStyle, sdkStyle, sln } from './helpers.js';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const at = (p) => join(root, p).split('\\').join('/');
const quiet = { out: () => {}, err: () => {} };
const example = at('examples/OrdersPortal.sln');

async function capture(argv, limits) {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (t) => { out += t; }, err: (t) => { err += t; } }, limits);
  return { code, out, err };
}

// A report with names and paths that try to break each format.
function hostile() {
  return scan({
    'Orders.sln': sln([['=cmd|x', '=cmd\\A.csproj'], ['B', 'B\\B.csproj']]),
    '=cmd/A.csproj': oldStyle({ refs: ['System.Web'] }),
    'B/B.csproj': sdkStyle({ target: 'net48' })
  }, { path: 'Orders.sln' });
}

test('parseArgs reads options and refuses bad input', () => {
  const o = parseArgs(['--path', 'Orders.sln', '--format', 'csv', '--fail-on', 'warning', '--limit', '50']);
  assert.deepEqual([o.path, o.format, o.failOn, o.limit], ['Orders.sln', 'csv', 'warning', 50]);
  const d = parseArgs(['src']);
  assert.deepEqual([d.path, d.format, d.failOn, d.limit], ['src', 'text', 'error', 200]);
  assert.equal(parseArgs(['--help']).help, true);
  assert.throws(() => parseArgs([]), /give the folder of the solution, or its \.sln file, with --path/);
  assert.throws(() => parseArgs(['a', 'b']), /give one folder or \.sln file, not also b/);
  assert.throws(() => parseArgs(['--path', 'a', '--path', 'b']), /give one --path/);
  assert.throws(() => parseArgs(['a', '--format', 'sarif']), /unknown format sarif/);
  assert.throws(() => parseArgs(['a', '--format', 'toString']), /unknown format/);
  assert.throws(() => parseArgs(['a', '--fail-on', 'info']), /error or warning/);
  assert.throws(() => parseArgs(['a', '--limit', '0']), /--limit takes a whole number/);
  assert.throws(() => parseArgs(['--path']), /needs a value/);
  assert.throws(() => parseArgs(['a', '--fix']), /unknown argument --fix/);
  assert.throws(() => parseArgs(['-']), /standard input/);
  assert.throws(() => parseArgs(['--path', 'https://example.test/Orders.sln']), /never fetches a URL/);
});

test('exit codes: 0 without errors, 1 on errors or with --fail-on warning, 2 on usage or input errors', async () => {
  assert.equal(await main(['--path', example], quiet), 0);
  assert.equal(await main(['--path', example, '--fail-on', 'warning'], quiet), 1);
  assert.equal(await main(['--nope'], quiet), 2);
  assert.equal(await main(['--help'], quiet), 0);
  const v = await capture(['--version']);
  assert.equal(v.out.trim(), VERSION);
  assert.equal(VERSION, '1.0.0');
  const missing = await capture(['--path', at('examples/None.sln')]);
  assert.deepEqual([missing.code, /no such file or folder/.test(missing.err)], [2, true]);
  const notSln = await capture(['--path', at('package.json')]);
  assert.deepEqual([notSln.code, /give a folder or a \.sln file/.test(notSln.err)], [2, true]);
  const usage = await capture(['--format', 'json']);
  assert.equal(usage.code, 2);
  assert.ok(usage.err.includes(USAGE));
  await withFiles({ 'Orders.sln': sln([['Gone', 'Gone\\Gone.csproj']]) }, async (dir) => {
    const broken = await capture(['--path', join(dir, 'Orders.sln')]);
    assert.equal(broken.code, 1);
    assert.match(broken.out, /^ERROR +missing-project +Orders\.sln +Orders\.sln: line 4: the solution lists "Gone"/m);
    assert.ok(broken.out.endsWith('GATE: FAIL - 1 error\n'));
  });
});

test('size limits: a solution over the limit stops the run; a project over the limit is unreadable', async () => {
  await withFiles({ 'Orders.sln': sln([['A', 'A\\A.csproj']]), 'A/A.csproj': sdkStyle({ props: `<Description>${'x'.repeat(400)}</Description>` }) }, async (dir) => {
    const big = await capture(['--path', join(dir, 'Orders.sln')], { ...LIMITS, maxFileBytes: 200 });
    assert.equal(big.code, 2);
    assert.match(big.err, /Orders\.sln: \d+ bytes is over the .* MB limit/);
    const project = await capture(['--path', join(dir, 'Orders.sln')], { ...LIMITS, maxFileBytes: 400 });
    assert.equal(project.code, 1);
    assert.match(project.out, /ERROR +unreadable +A\/A\.csproj +A\/A\.csproj: \d+ bytes is over the .* MB limit/);
    const many = await capture(['--path', dir], { ...LIMITS, maxFiles: 1 });
    assert.deepEqual([many.code, /more than 1 files/.test(many.err)], [2, true]);
    assert.equal((await capture(['--path', dir])).code, 0);
  });
});

test('the example: summary lines, the project table, the move order and the gate', async () => {
  const { code, out } = await capture(['--path', example]);
  assert.equal(code, 0);
  assert.ok(out.startsWith(`dotnet-port-scan: ${example}\nsolutions: 1; projects: 5 (3 old-style, 2 SDK-style)\n`));
  assert.ok(out.includes('findings: 0 error, 11 warning, 10 info\n'));
  const steps = [...out.matchAll(/^(\d)\s+(\S+)\s+(library|service|app|test)\b/gm)].map((m) => `${m[1]} ${m[2]} ${m[3]}`);
  assert.deepEqual(steps, ['1 OrdersPortal.Contracts library', '2 OrdersPortal.Core library', '3 OrdersPortal.Services service', '4 OrdersPortal.Web app', '5 OrdersPortal.Tests test']);
  const order = [...out.matchAll(/^(WARNING|INFO) +([a-z-]+)/gm)].map((m) => m[2]);
  assert.deepEqual([...new Set(order)], ['old-style-project', 'packages-config', 'web-forms', 'wcf-service', 'asmx-service', 'system-web', 'http-modules', 'framework-target', 'windows-only', 'binding-redirects', 'wcf-client', 'netstandard-library', 'sdk-ready']);
  assert.ok(out.endsWith('GATE: PASS (--fail-on error)\n'));
});

test('--limit shows the first findings, projects and steps, and the total', async () => {
  const { out } = await capture(['--path', example, '--limit', '2']);
  assert.ok(out.includes('findings: 0 error, 11 warning, 10 info (showing 2 of 21)\n'));
  assert.equal((out.match(/^WARNING /gm) || []).length, 2);
  assert.ok(out.includes('note: showing the first 2 findings of 21; raise --limit to see more'));
  assert.ok(out.includes('note: showing the first 2 of 5 projects'));
});

test('JSON: the whole report with projects, references, order and findings', async () => {
  const r = JSON.parse((await capture(['--path', example, '--format', 'json'])).out);
  assert.equal(r.tool, 'dotnet-port-scan');
  assert.deepEqual([r.total, r.counts], [21, { error: 0, warning: 11, info: 10 }]);
  assert.equal(r.byCheck['old-style-project'], 3);
  const web = r.projects.find((p) => p.name === 'OrdersPortal.Web');
  assert.deepEqual([web.style, web.language, web.outputType, web.targets, web.kind, web.packageSource, web.solutionFolder], ['old-style', 'C#', 'Library', ['v4.7.2'], 'Web Forms', 'packages.config', 'src']);
  assert.deepEqual(web.projectReferences, ['OrdersPortal.Core', 'OrdersPortal.Contracts']);
  assert.deepEqual(web.windowsOnly, ['System.Drawing']);
  assert.deepEqual(web.packages[0], { id: 'Example.Json', version: '12.0.3' });
  assert.deepEqual(r.order[3], { position: 4, name: 'OrdersPortal.Web', group: 'app', after: ['OrdersPortal.Core', 'OrdersPortal.Contracts'], cycle: false });
  // Paths in the report are relative to the solution folder; only the input is shown as it was given.
  assert.equal(r.input, example);
  assert.ok(!JSON.stringify({ ...r, input: '' }).includes(root.split('\\').join('/')));
  const h = await hostile();
  assert.equal(toJson(h), JSON.stringify(h, null, 2) + '\n');
});

test('Markdown escapes pipes, backslashes and line breaks in every cell', async () => {
  assert.equal(mdCell('a|b\\c\nd'), 'a\\|b\\\\c d');
  const md = toMarkdown(await hostile());
  assert.ok(md.startsWith('## dotnet-port-scan: 0 error, 2 warning, 2 info\n'));
  assert.ok(md.includes('| =cmd\\|x | old-style | v4.7.2 | class library | - | - |'));
  for (const line of md.split('\n').filter((l) => l.startsWith('| warning') || l.startsWith('| info'))) assert.equal(line.split(/(?<!\\)\|/).length, 6, line);
});

test('CSV quotes as RFC 4180 says and defuses formulas', async () => {
  assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csvCell('+1'), "'+1");
  assert.equal(csvCell('-1'), "'-1");
  assert.equal(csvCell('@x'), "'@x");
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
  assert.equal(csvCell(null), '');
  const csv = toCsv(await hostile());
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'type,severity,id,project,file,message');
  assert.ok(lines.some((l) => l.startsWith("finding,warning,old-style-project,'=cmd|x,'=cmd/A.csproj,\"'=cmd|x is an old-style project file")));
  assert.ok(lines.includes("project,,class library,B,B/B.csproj,sdk; net48; packages: -; references: -"));
  assert.ok(lines.some((l) => l.startsWith("order,,2,B,,library; after: -")));
  assert.ok(csv.endsWith('\r\n'));
});

test('text: control characters from the input cannot reach the terminal', async () => {
  const esc = String.fromCharCode(27);
  const r = await scan({ 'Orders.sln': sln([[`Web${esc}]0;title${esc}[2J`, 'Web\\Web.csproj']]), 'Web/Web.csproj': sdkStyle() }, { path: 'Orders.sln' });
  const text = toText(r);
  assert.ok(!text.includes(esc));
  assert.ok(text.includes('Web ]0;title [2J'));
});
