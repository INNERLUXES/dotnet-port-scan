import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FINDINGS, SEVERITIES, RANK, DEFAULTS, isFindingId, meetsThreshold, safeText, plural, listOf, checkScan } from '../src/index.js';
import { scan, oldStyle, sdkStyle, sln, ids, find } from './helpers.js';

const WEB_CONFIG = `<?xml version="1.0"?>
<configuration>
  <system.web>
    <compilation targetFramework="4.6.1" />
    <httpModules><add name="Audit" type="Audit, Web" /></httpModules>
  </system.web>
  <system.webServer>
    <modules><add name="Audit" type="Audit, Web" /><add name="Headers" type="Headers, Web" /></modules>
    <handlers><add name="Chart" path="chart.axd" verb="GET" type="Chart, Web" /></handlers>
  </system.webServer>
  <system.serviceModel><client><endpoint name="Stock" contract="IStock" /></client></system.serviceModel>
  <runtime><assemblyBinding xmlns="urn:schemas-microsoft-com:asm.v1"><dependentAssembly><assemblyIdentity name="Example.Json" /><bindingRedirect oldVersion="0.0.0.0-9.0.0.0" newVersion="9.0.0.0" /></dependentAssembly></assemblyBinding></runtime>
</configuration>`;

test('every check has an id and a known severity, and the list is complete', () => {
  assert.deepEqual(FINDINGS.map((f) => f.id), [
    'missing-project', 'unreadable', 'reference-cycle', 'old-style-project', 'packages-config', 'web-forms', 'wcf-service',
    'asmx-service', 'system-web', 'http-modules', 'framework-target', 'windows-only', 'binding-redirects', 'wcf-client',
    'netstandard-library', 'sdk-ready'
  ]);
  for (const f of FINDINGS) assert.ok(SEVERITIES.includes(f.severity), f.id);
  assert.ok(isFindingId('web-forms'));
  assert.ok(!isFindingId('toString'));
  assert.ok(RANK.error < RANK.warning && RANK.warning < RANK.info);
  assert.ok(meetsThreshold('error', 'warning') && !meetsThreshold('warning', 'error') && !meetsThreshold('info', 'warning'));
  assert.equal(DEFAULTS.limit, 200);
  assert.equal(plural(1, 'page'), '1 page');
  assert.equal(plural(1500, 'page'), '1,500 pages');
  assert.equal(listOf(['a', 'b', 'a', 'c'], 2), 'a, b and 1 more');
});

test('safeText removes control and direction characters and caps the length', () => {
  const esc = String.fromCharCode(27);
  const rlo = String.fromCharCode(0x202e);
  assert.equal(safeText(`a${esc}[2Jb${rlo}c\nd`), 'a [2Jb c d');
  assert.equal(safeText('x'.repeat(20), 10), 'xxxxxxx...');
});

test('an old-style Web Forms project: old-style-project, packages-config, framework-target, web-forms, system-web, windows-only', async () => {
  const r = await scan({
    'Web/Web.csproj': oldStyle({ version: 'v4.6.1', refs: ['System', 'System.Web', 'System.Web.Extensions', 'System.Drawing', 'System.Management'] }),
    'Web/packages.config': '<packages><package id="Example.A" version="1.0.0" /><package id="Example.B" version="2.0.0" /></packages>',
    'Web/Default.aspx': '', 'Web/About.aspx': '', 'Web/Site.Master': '', 'Web/Nav.ascx': ''
  });
  assert.deepEqual(ids(r), ['old-style-project', 'packages-config', 'web-forms', 'system-web', 'framework-target', 'windows-only']);
  assert.match(find(r, 'old-style-project')[0].message, /^Web is an old-style project file \(no Sdk attribute, ToolsVersion 15\.0\)/);
  assert.equal(find(r, 'packages-config')[0].file, 'Web/packages.config');
  assert.match(find(r, 'packages-config')[0].message, /lists 2 packages in packages\.config \(Example\.A, Example\.B\)/);
  assert.match(find(r, 'web-forms')[0].message, /has 2 Web Forms pages, 1 user control, 1 master page; ASP\.NET Core has no Web Forms/);
  assert.match(find(r, 'system-web')[0].message, /references System\.Web, System\.Web\.Extensions;/);
  assert.match(find(r, 'framework-target')[0].message, /targets \.NET Framework 4\.6\.1 \(v4\.6\.1\)$/);
  assert.match(find(r, 'windows-only')[0].message, /Windows-only APIs: System\.Drawing, System\.Management;/);
  assert.deepEqual(r.projects[0].frameworkOnly, ['System.Web', 'System.Web.Extensions']);
  assert.deepEqual([r.projects[0].kind, r.projects[0].packageSource], ['Web Forms', 'packages.config']);
  assert.equal(r.gate.pass, true);
});

test('web.config: http-modules, binding-redirects and wcf-client, each pointing at the config file', async () => {
  const r = await scan({ 'Web/Web.csproj': oldStyle({ refs: ['System.Web'] }), 'Web/Web.config': WEB_CONFIG });
  const at = (id) => find(r, id).map((f) => [f.file, f.message]);
  assert.deepEqual(at('http-modules'), [['Web/Web.config', 'Web/Web.config registers 2 HTTP modules (Audit, Headers) and 1 HTTP handler (Chart) for Web; ASP.NET Core has no modules or handlers. Rewrite them as middleware']]);
  assert.match(at('binding-redirects')[0][1], /has 1 assembly binding redirect \(Example\.Json 9\.0\.0\.0\)/);
  assert.match(at('wcf-client')[0][1], /configures 1 WCF client endpoint \(Stock\)/);
  assert.equal(r.projects[0].kind, 'web application');
});

test('wcf-service from .svc files or services in web.config; asmx-service from .asmx files', async () => {
  const services = '<configuration><system.serviceModel><services><service name="Orders" /><service name="Stock" /></services></system.serviceModel></configuration>';
  const r = await scan({
    'Svc/Svc.csproj': oldStyle({ refs: ['System.ServiceModel'] }), 'Svc/Web.config': services,
    'Old/Old.csproj': oldStyle({ refs: ['System.Web.Services'] }), 'Old/Legacy.asmx': '', 'Old/Other.asmx': '',
    'Both/Both.csproj': oldStyle(), 'Both/A.svc': ''
  });
  const wcf = find(r, 'wcf-service').map((f) => [f.project, f.message.match(/\(([^)]*)\)/)[1]]);
  assert.deepEqual(wcf, [['Both', '1 .svc file'], ['Svc', '2 services in Svc/Web.config']]);
  assert.match(find(r, 'asmx-service')[0].message, /^Old has 2 ASMX web services \(\.asmx\)/);
  assert.deepEqual(r.projects.map((p) => [p.name, p.kind]), [['Both', 'WCF service'], ['Old', 'ASMX web service'], ['Svc', 'WCF service']]);
});

test('netstandard-library, sdk-ready and multi-targeting; Windows-only targets and switches', async () => {
  const r = await scan({
    'Contracts/Contracts.csproj': sdkStyle({ target: 'netstandard2.0' }),
    'Multi/Multi.csproj': sdkStyle({ target: 'net48;net8.0' }),
    'Desk/Desk.csproj': sdkStyle({ target: 'net8.0-windows', props: '<UseWPF>true</UseWPF><OutputType>WinExe</OutputType>' })
  });
  const by = (name) => r.findings.filter((f) => f.project === name).map((f) => f.id);
  assert.deepEqual(by('Contracts'), ['netstandard-library']);
  assert.deepEqual(by('Multi'), ['framework-target', 'sdk-ready']);
  assert.deepEqual(by('Desk'), ['windows-only', 'sdk-ready']);
  assert.match(find(r, 'windows-only')[0].message, /UseWPF, net8\.0-windows target/);
  assert.match(find(r, 'sdk-ready').find((f) => f.project === 'Multi').message, /already targets modern \.NET \(net8\.0\)/);
  assert.equal(r.projects.find((p) => p.name === 'Desk').kind, 'desktop (WPF)');
  assert.equal(r.summary.oldStyle, 0);
});

test('reference-cycle: projects that reference each other fail the gate and are listed last in the order', async () => {
  const r = await scan({
    'A/A.csproj': sdkStyle({ target: 'net48', items: '<ProjectReference Include="..\\B\\B.csproj" />' }),
    'B/B.csproj': sdkStyle({ target: 'net48', items: '<ProjectReference Include="..\\A\\A.csproj" />' }),
    'C/C.csproj': sdkStyle({ target: 'netstandard2.0' })
  });
  assert.deepEqual(find(r, 'reference-cycle').map((f) => [f.severity, f.file, f.message.split(':')[0]]), [['error', 'A/A.csproj', 'A -> B -> A']]);
  assert.deepEqual(r.order.map((o) => [o.name, o.cycle]), [['C', false], ['A', true], ['B', true]]);
  assert.deepEqual(r.cycles, [['A', 'B']]);
  assert.deepEqual([r.gate.pass, r.gate.reason], [false, '1 error']);
});

test('an unreadable project is an error, keeps its row and is left out of the move order', async () => {
  const r = await scan({ 'Bad/Bad.csproj': '<!DOCTYPE x><Project/>', 'Good/Good.csproj': sdkStyle() });
  assert.deepEqual(find(r, 'unreadable').map((f) => f.file), ['Bad/Bad.csproj']);
  assert.deepEqual(r.projects.map((p) => [p.name, p.style]), [['Bad', 'unreadable'], ['Good', 'sdk']]);
  assert.deepEqual(r.order.map((o) => o.name), ['Good']);
  assert.ok(r.notes.includes('Bad/Bad.csproj could not be read and is left out of the move order'));
  assert.equal(r.summary.unreadable, 1);
});

test('a solution already on modern .NET: info only, the gate passes even with --fail-on warning', async () => {
  const r = await scan({ 'App.sln': sln([['Api', 'Api\\Api.csproj']]), 'Api/Api.csproj': sdkStyle({ sdk: 'Microsoft.NET.Sdk.Web' }), 'Api/Program.cs': '' }, { path: 'App.sln', failOn: 'warning' });
  assert.deepEqual(ids(r), ['sdk-ready']);
  assert.deepEqual([r.gate.pass, r.projects[0].kind, r.order[0].group], [true, 'ASP.NET Core web', 'app']);
});

test('--fail-on warning fails on warnings; the gate counts findings beyond the limit', async () => {
  const files = { 'P1/P1.csproj': oldStyle(), 'P2/P2.csproj': oldStyle(), 'P3/P3.csproj': oldStyle() };
  const r = await scan(files, { failOn: 'warning', limit: 2 });
  assert.equal(r.total, 6);
  assert.equal(r.findings.length, 2);
  assert.deepEqual([r.gate.pass, r.gate.reason], [false, '3 warnings']);
  assert.ok(r.notes.includes('showing the first 2 findings of 6; raise --limit to see more'));
  assert.ok(r.notes.includes('showing the first 2 of 3 projects'));
  assert.equal(r.projects.length, 2);
  const empty = checkScan({ input: 'x', solutions: [], projects: [], problems: [], notes: [], totals: { webForms: 0 } });
  assert.deepEqual([empty.total, empty.gate.pass, empty.order.length], [0, true, 0]);
});
