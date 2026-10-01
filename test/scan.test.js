import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { scanPath, isInside, isWindowsAbsolute, resolveWritten, readBounded, findIgnoringCase, fileKind, emptyCounts, LIMITS, SKIP_FOLDERS } from '../src/index.js';
import { withFiles, scan, oldStyle, sdkStyle, sln, find } from './helpers.js';

test('files are counted by kind, ignoring case', () => {
  const kinds = ['Default.aspx', 'Grid.ASCX', 'Site.Master', 'Global.asax', 'Orders.svc', 'Old.asmx', 'Index.cshtml', 'Index.vbhtml', 'A.cs', 'B.vb', 'C.fs', 'Web.config', 'readme.txt', '.aspx'].map(fileKind);
  assert.deepEqual(kinds, ['webForms', 'userControls', 'masterPages', 'globalAsax', 'wcf', 'asmx', 'razor', 'razor', 'code', 'code', 'code', null, null, null]);
  assert.deepEqual(Object.keys(emptyCounts()), ['webForms', 'userControls', 'masterPages', 'globalAsax', 'wcf', 'asmx', 'razor', 'code']);
  assert.deepEqual(SKIP_FOLDERS, ['bin', 'obj', 'packages', 'node_modules', '.git', '.vs']);
});

test('paths written in solution and project files are resolved and checked against the folder, without links', () => {
  const root = resolve(tmpdir(), 'example-root');
  assert.ok(isInside(root, root));
  assert.ok(isInside(root, join(root, 'src', 'A.csproj')));
  assert.ok(isInside(root, join(root, '..foo', 'A.csproj')));
  assert.ok(!isInside(root, resolve(root, '..', 'other', 'A.csproj')));
  assert.ok(!isInside(root, `${root}-sibling`));
  assert.equal(resolveWritten(join(root, 'src', 'Web'), '..\\Core\\Core.csproj'), join(root, 'src', 'Core', 'Core.csproj'));
  assert.ok(!isInside(root, resolveWritten(join(root, 'src'), '..\\..\\..\\secrets\\Keys.csproj')));
  assert.ok(isWindowsAbsolute('C:\\work\\A.csproj') && isWindowsAbsolute('d:/x.csproj') && isWindowsAbsolute('\\\\server\\share\\A.csproj'));
  assert.ok(!isWindowsAbsolute('src\\A.csproj') && !isWindowsAbsolute('/usr/src/A.csproj'));
  // A drive path cannot name a file on Linux or macOS; on Windows it resolves to that drive, outside the root.
  const drive = resolveWritten(root, 'Q:\\elsewhere\\A.csproj');
  assert.ok(sep === '/' ? drive === null : !isInside(root, drive));
  // An absolute POSIX path is absolute on every system and outside the root.
  assert.ok(!isInside(root, resolveWritten(root, '/etc/A.csproj')));
});

test('a folder: every project and solution is found, files are counted per project, build folders are skipped', async () => {
  const files = {
    'Orders.sln': sln([['Web', 'Web\\Web.csproj'], ['Lib', 'Lib\\Lib.csproj']]),
    'Web/Web.csproj': oldStyle({ refs: ['System.Web'], projectRefs: ['..\\Lib\\Lib.csproj'] }),
    'Web/Default.aspx': '<%@ Page %>',
    'Web/Pages/Orders.aspx': '<%@ Page %>',
    'Web/Default.aspx.cs': '',
    'Web/bin/Copied.aspx': '',
    'Web/obj/Debug/Temp.cs': '',
    'Lib/Lib.csproj': sdkStyle({ target: 'netstandard2.0' }),
    'Lib/Rules.cs': '',
    'packages/Example.Json/Example.Json.csproj': sdkStyle(),
    'node_modules/x/Y.csproj': sdkStyle(),
    'tools/loose.cs': ''
  };
  const r = await scan(files);
  assert.deepEqual(r.solutions, ['Orders.sln']);
  assert.deepEqual(r.projects.map((p) => [p.name, p.file, p.files.webForms, p.files.code]), [['Web', 'Web/Web.csproj', 2, 1], ['Lib', 'Lib/Lib.csproj', 0, 1]]);
  assert.deepEqual([r.summary.files.webForms, r.summary.files.code], [2, 3]);
  assert.deepEqual(r.projects[0].projectReferences, ['Lib']);
  assert.equal(r.projects[0].solutionFolder, null);
});

test('a .sln path: projects outside the folder, Windows drive paths and missing files are reported, not read', async () => {
  const files = {
    'app/Orders.sln': sln([
      ['Web', 'Web\\Web.csproj'],
      ['Escape', '..\\outside\\Escape.csproj'],
      ['Drive', 'C:\\build\\Drive.csproj'],
      ['Gone', 'Gone\\Gone.csproj']
    ]),
    'app/Web/Web.csproj': oldStyle({ projectRefs: ['..\\Missing\\Missing.csproj', '..\\..\\outside\\Escape.csproj'] }),
    'app/Extra/Extra.csproj': sdkStyle(),
    'outside/Escape.csproj': sdkStyle()
  };
  const r = await scan(files, { path: 'app/Orders.sln' });
  assert.deepEqual(r.projects.map((p) => p.name), ['Web']);
  const unreadable = find(r, 'unreadable').map((f) => f.message);
  assert.equal(unreadable.length, 2);
  assert.ok(unreadable.some((m) => /line 6: the project "Escape" at \.\.\/outside\/Escape\.csproj lies outside the folder of the solution/.test(m)));
  assert.ok(unreadable.some((m) => /line 8: the project "Drive" at C:\/build\/Drive\.csproj lies outside the folder of the solution/.test(m)));
  const missing = find(r, 'missing-project').map((f) => [f.file, f.message]);
  assert.deepEqual(missing.map((m) => m[0]), ['Orders.sln', 'Web/Web.csproj']);
  assert.match(missing[0][1], /the solution lists "Gone" at Gone\/Gone\.csproj, but there is no such file/);
  assert.match(missing[1][1], /Web references \.\.\/Missing\/Missing\.csproj, but there is no such file/);
  assert.ok(r.notes.includes('Web/Web.csproj: the project reference ../../outside/Escape.csproj lies outside the folder and was not followed'));
  assert.ok(r.notes.includes('1 project file(s) in the folder are not in the solution and were not read: Extra/Extra.csproj'));
  assert.equal(r.gate.pass, false);
});

test('letter case: paths are matched ignoring case as on Windows, and the difference is noted', async () => {
  const files = {
    'Orders.sln': sln([['Core', 'SRC\\Orders.Core\\orders.core.csproj'], ['Web', 'src\\orders.web\\Orders.Web.csproj']]),
    'src/orders.core/Orders.Core.csproj': sdkStyle({ target: 'net48' }),
    'src/orders.web/Orders.Web.csproj': oldStyle({ projectRefs: ['..\\Orders.Core\\Orders.Core.csproj'] })
  };
  const r = await scan(files, { path: 'Orders.sln' });
  assert.deepEqual(r.projects.map((p) => [p.name, p.file]), [['Core', 'src/orders.core/Orders.Core.csproj'], ['Web', 'src/orders.web/Orders.Web.csproj']]);
  assert.deepEqual(r.projects[1].projectReferences, ['Core']);
  assert.ok(r.notes.some((n) => n.startsWith('Orders.sln: line 4: SRC/Orders.Core/orders.core.csproj is written with other letter case than the file on disk (src/orders.core/Orders.Core.csproj)')));
  assert.ok(r.notes.some((n) => n.startsWith('src/orders.web/Orders.Web.csproj: the project reference ../Orders.Core/Orders.Core.csproj is written with other letter case')));
  assert.deepEqual(find(r, 'missing-project'), []);
  assert.deepEqual(r.order.map((o) => o.name), ['Core', 'Web']);
});

test('findIgnoringCase looks up each part of a path and stays inside the root', async () => {
  await withFiles({ 'Src/Models/Customer.cs': '' }, async (dir) => {
    assert.deepEqual(await findIgnoringCase(dir, join(dir, 'Src', 'Models', 'Customer.cs')), { path: join(dir, 'Src', 'Models', 'Customer.cs'), caseDiffers: false });
    assert.deepEqual(await findIgnoringCase(dir, join(dir, 'src', 'models', 'customer.CS')), { path: join(dir, 'Src', 'Models', 'Customer.cs'), caseDiffers: true });
    assert.equal(await findIgnoringCase(dir, join(dir, 'src', 'Customer.cs')), null);
    assert.equal(await findIgnoringCase(join(dir, 'Src'), join(dir, 'Src', '..', 'other.cs')), null);
  });
});

test('links that lead outside the folder are never followed (skipped where links cannot be made)', async (t) => {
  const outside = await mkdtemp(join(tmpdir(), 'dotnet-port-scan-outside-'));
  try {
    await writeFile(join(outside, 'Secret.csproj'), sdkStyle());
    await writeFile(join(outside, 'Page.aspx'), '');
    await withFiles({ 'Web/Web.csproj': sdkStyle(), 'Inner/Inside.cs': '' }, async (dir) => {
      try {
        await symlink(outside, join(dir, 'Web', 'linked'), 'junction');
        await symlink(join(dir, 'Inner'), join(dir, 'Web', 'inner-link'), 'junction');
      } catch (error) {
        t.skip(`links cannot be made here (${error.code})`);
        return;
      }
      await writeFile(join(dir, 'Orders.sln'), sln([['Web', 'Web\\Web.csproj'], ['Secret', 'Web\\linked\\Secret.csproj']]));
      const folder = await scanPath(dir);
      assert.deepEqual(folder.projects.map((p) => p.name), ['Web']);
      assert.equal(folder.totals.webForms, 0);
      assert.ok(folder.notes.includes('Web/linked: a link that leads outside the folder; not followed'));
      assert.ok(folder.notes.includes('Web/inner-link: a link to a folder; not followed, so nothing is counted twice'));
      const viaSln = await scanPath(join(dir, 'Orders.sln'));
      assert.deepEqual(viaSln.projects.map((p) => p.name), ['Web']);
      assert.ok(viaSln.problems.some((p) => p.id === 'unreadable' && /"Secret" at Web\/linked\/Secret\.csproj is a link that leads outside the folder/.test(p.message)));
    });
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

test('readBounded: the size limit, a UTF-8 byte order mark and UTF-16 files', async () => {
  await withFiles({ 'big.csproj': 'x'.repeat(200), 'bom.csproj': '\uFEFF<Project />' }, async (dir) => {
    await assert.rejects(readBounded(join(dir, 'big.csproj'), { ...LIMITS, maxFileBytes: 100 }, 'big.csproj'), /big\.csproj: 200 bytes is over the 0\.0000953\d* MB limit/);
    assert.equal(await readBounded(join(dir, 'bom.csproj')), '<Project />');
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<Project Sdk="Microsoft.NET.Sdk" />', 'utf16le')]);
    await writeFile(join(dir, 'u16.csproj'), utf16);
    assert.equal(await readBounded(join(dir, 'u16.csproj')), '<Project Sdk="Microsoft.NET.Sdk" />');
    const be = Buffer.from([0xfe, 0xff, 0x00, 0x3c, 0x00, 0x61, 0x00, 0x2f, 0x00, 0x3e]);
    await writeFile(join(dir, 'be.csproj'), be);
    assert.equal(await readBounded(join(dir, 'be.csproj')), '<a/>');
    await assert.rejects(readBounded(dir), /not a file/);
  });
});

test('limits: too many files, projects or folder levels stop the scan; an unreadable project is reported', async () => {
  const files = { 'A/A.csproj': sdkStyle(), 'B/B.csproj': sdkStyle(), 'B/x.cs': '', 'B/y.cs': '', 'C/C.csproj': '<Project><PropertyGroup></Project>' };
  await withFiles(files, async (dir) => {
    await assert.rejects(scanPath(dir, { ...LIMITS, maxFiles: 4 }), /more than 4 files in the folder/);
    await assert.rejects(scanPath(dir, { ...LIMITS, maxProjects: 2 }), /more than 2 project files/);
    await assert.rejects(scanPath(dir, { ...LIMITS, maxDepth: 0 }), /folders nested more than 0 deep/);
    const ok = await scanPath(dir);
    assert.deepEqual(ok.problems.map((p) => [p.id, p.file]), [['unreadable', 'C/C.csproj']]);
    assert.match(ok.problems[0].message, /C\/C\.csproj: line 1: <\/Project> does not close <PropertyGroup>/);
    assert.equal(ok.projects.length, 3);
  });
  await assert.rejects(scanPath(join(tmpdir(), 'dotnet-port-scan-none', 'x')), /no such file or folder/);
  await withFiles({ 'readme.txt': 'x', 'bad.sln': 'not a solution' }, async (dir) => {
    await assert.rejects(scanPath(join(dir, 'readme.txt')), /give a folder or a \.sln file/);
    await assert.rejects(scanPath(join(dir, 'bad.sln')), /not a Visual Studio solution file/);
    const folder = await scanPath(dir);
    assert.deepEqual(folder.problems.map((p) => [p.id, p.file]), [['unreadable', 'bad.sln']]);
  });
  await assert.rejects(scanPath('https://example.test/Orders.sln'), /never fetches a URL/);
});

test('two projects in one folder: files are counted once, for the first', async () => {
  const r = await scan({ 'App/App.csproj': sdkStyle(), 'App/App.Tests.csproj': sdkStyle({ props: '<IsTestProject>true</IsTestProject>' }), 'App/x.cs': '' });
  assert.deepEqual(r.projects.map((p) => [p.name, p.files.code]), [['App.Tests', 1], ['App', 0]]);
  assert.ok(r.notes.includes('App/App.csproj shares its folder with App/App.Tests.csproj; the files there are counted for App.Tests'));
});
