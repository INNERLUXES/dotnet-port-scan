// Runs the README examples and checks that they report what the README shows.

import { main } from '../src/index.js';

async function run(argv) {
  let out = '';
  const code = await main(argv, { out: (t) => { out += t; }, err: (t) => process.stderr.write(t) });
  process.stdout.write(out);
  return { code, out };
}

const problems = [];
function expect(name, result, code, expected, unwanted) {
  const missing = expected.filter((e) => !result.out.includes(e));
  const wrong = unwanted.filter((e) => result.out.includes(e));
  if (result.code !== code || missing.length || wrong.length) {
    problems.push(`${name}: unexpected report (exit code ${result.code}, expected ${code}; missing: ${missing.join(' / ') || 'none'}; should not appear: ${wrong.join(' / ') || 'none'})`);
  }
}

const solution = await run(['--path', 'examples/OrdersPortal.sln']);
expect('OrdersPortal.sln', solution, 0, [
  'dotnet-port-scan: examples/OrdersPortal.sln',
  'solutions: 1; projects: 5 (3 old-style, 2 SDK-style)',
  'files: 3 Web Forms pages, 1 user control, 1 master page, 1 Global.asax, 1 WCF service, 1 ASMX service, 0 Razor views, 12 code files',
  'findings: 0 error, 11 warning, 10 info',
  'OrdersPortal.Web        old-style  v4.7.2          Web Forms      3 (packages.config)   OrdersPortal.Core, OrdersPortal.Contracts',
  'OrdersPortal.Services   old-style  v4.8            WCF service    -                     OrdersPortal.Core, OrdersPortal.Contracts',
  'OrdersPortal.Core       old-style  v4.8            class library  1 (packages.config)   OrdersPortal.Contracts',
  'OrdersPortal.Contracts  sdk        netstandard2.0  class library  -                     -',
  'OrdersPortal.Tests      sdk        net8.0          test           2 (PackageReference)  OrdersPortal.Contracts',
  '1     OrdersPortal.Contracts  library  -',
  '2     OrdersPortal.Core       library  OrdersPortal.Contracts',
  '3     OrdersPortal.Services   service  OrdersPortal.Core, OrdersPortal.Contracts',
  '4     OrdersPortal.Web        app      OrdersPortal.Core, OrdersPortal.Contracts',
  '5     OrdersPortal.Tests      test     OrdersPortal.Contracts',
  'WARNING   old-style-project    src/OrdersPortal.Web/OrdersPortal.Web.csproj  OrdersPortal.Web is an old-style project file',
  'WARNING   packages-config      src/OrdersPortal.Web/packages.config  OrdersPortal.Web lists 3 packages in packages.config (Example.Json, Example.Logging, Example.Web.Optimization)',
  'WARNING   web-forms            src/OrdersPortal.Web/OrdersPortal.Web.csproj  OrdersPortal.Web has 3 Web Forms pages, 1 user control, 1 master page',
  'WARNING   wcf-service          src/OrdersPortal.Services/OrdersPortal.Services.csproj  OrdersPortal.Services hosts WCF services (1 .svc file, 1 service in src/OrdersPortal.Services/Web.config)',
  'WARNING   asmx-service         src/OrdersPortal.Services/OrdersPortal.Services.csproj  OrdersPortal.Services has 1 ASMX web service',
  'WARNING   system-web           src/OrdersPortal.Web/OrdersPortal.Web.csproj  OrdersPortal.Web references System.Web, System.Web.Extensions',
  'WARNING   http-modules         src/OrdersPortal.Web/Web.config  src/OrdersPortal.Web/Web.config registers 1 HTTP module (OrdersAuditModule) and 1 HTTP handler (OrderChart)',
  'INFO      framework-target     src/OrdersPortal.Web/OrdersPortal.Web.csproj  OrdersPortal.Web targets .NET Framework 4.7.2 (v4.7.2)',
  'INFO      windows-only         src/OrdersPortal.Services/OrdersPortal.Services.csproj  OrdersPortal.Services uses Windows-only APIs: System.DirectoryServices',
  'INFO      windows-only         src/OrdersPortal.Web/OrdersPortal.Web.csproj  OrdersPortal.Web uses Windows-only APIs: System.Drawing',
  'INFO      binding-redirects    src/OrdersPortal.Web/Web.config  src/OrdersPortal.Web/Web.config has 2 assembly binding redirects (Example.Json 12.0.0.0, Example.Logging 4.1.0.0)',
  'INFO      wcf-client           src/OrdersPortal.Web/Web.config  src/OrdersPortal.Web/Web.config configures 1 WCF client endpoint (OrderService)',
  'INFO      netstandard-library  src/OrdersPortal.Contracts/OrdersPortal.Contracts.csproj  OrdersPortal.Contracts targets netstandard2.0',
  'INFO      sdk-ready            tests/OrdersPortal.Tests/OrdersPortal.Tests.csproj  OrdersPortal.Tests already targets modern .NET (net8.0)',
  'GATE: PASS (--fail-on error)'
], ['ERROR', 'note:']);

process.stdout.write('\n');
const folder = await run(['--path', 'examples', '--fail-on', 'warning']);
expect('examples folder with --fail-on warning', folder, 1, [
  'dotnet-port-scan: examples',
  'solutions: 1; projects: 5 (3 old-style, 2 SDK-style)',
  'findings: 0 error, 11 warning, 10 info',
  'GATE: FAIL - 11 warnings'
], ['ERROR']);

let json = '';
const jsonCode = await main(['--path', 'examples/OrdersPortal.sln', '--format', 'json'], { out: (t) => { json += t; }, err: (t) => process.stderr.write(t) });
const report = JSON.parse(json);
const order = report.order.map((o) => `${o.position} ${o.name} ${o.group}`).join(', ');
const expectedOrder = '1 OrdersPortal.Contracts library, 2 OrdersPortal.Core library, 3 OrdersPortal.Services service, 4 OrdersPortal.Web app, 5 OrdersPortal.Tests test';
if (jsonCode !== 0 || order !== expectedOrder || report.cycles.length !== 0) problems.push(`json: unexpected move order (${order})`);
const web = report.projects.find((p) => p.name === 'OrdersPortal.Web');
if (!web || web.solutionFolder !== 'src' || web.frameworkOnly.join(',') !== 'System.Web,System.Web.Extensions' || web.files.webForms !== 3) problems.push('json: unexpected OrdersPortal.Web record');

if (problems.length) {
  for (const p of problems) console.error(`example: ${p}`);
  process.exit(1);
}
