import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSln, toSlash, isProjectPath, SOLUTION_FOLDER, WEB_SITE, PROJECT_EXTENSIONS } from '../src/index.js';
import { sln } from './helpers.js';

test('Project entries: Windows backslash paths become forward slashes, solution folders are kept apart', () => {
  const text = sln([['Orders.Web', 'src\\Orders.Web\\Orders.Web.csproj'], ['Orders.Lib', 'src\\lib\\Orders.Lib.vbproj'], ['Orders.Fs', '.\\tools\\Orders.Fs.fsproj']], { folders: ['src', 'libs'], nested: [[0, 0], [1, 1], ['f1', 0]] });
  const s = parseSln(text, 'Orders.sln');
  assert.equal(s.formatVersion, '12.00');
  assert.deepEqual(s.projects.map((p) => [p.name, p.path, p.folder, p.line]), [
    ['Orders.Web', 'src/Orders.Web/Orders.Web.csproj', 'src', 8],
    ['Orders.Lib', 'src/lib/Orders.Lib.vbproj', 'src/libs', 10],
    ['Orders.Fs', 'tools/Orders.Fs.fsproj', '', 12]
  ]);
  assert.deepEqual(s.folders.map((f) => f.name), ['src', 'libs']);
  assert.equal(s.projects[0].type, 'FAE04EC0-301F-11D3-BF4B-00C04F79EFBC');
  assert.equal(SOLUTION_FOLDER, '2150E333-8FDC-42A3-9474-1A3956D46DE8');
});

test('web site projects and other project types are listed apart, not read as projects', () => {
  const text = [
    'Microsoft Visual Studio Solution File, Format Version 12.00',
    `Project("{${WEB_SITE}}") = "OldSite", "http://localhost/OldSite", "{00000000-0000-4000-8000-000000000001}"`,
    'EndProject',
    'Project("{00D1A9C2-B5F0-4AF3-8072-F6C62B433612}") = "Orders.Db", "db\\Orders.Db.sqlproj", "{00000000-0000-4000-8000-000000000002}"',
    'EndProject',
    ''
  ].join('\n');
  const s = parseSln(text);
  assert.deepEqual(s.projects, []);
  assert.deepEqual(s.others.map((o) => [o.name, o.path, o.line]), [['OldSite', 'http://localhost/OldSite', 2], ['Orders.Db', 'db/Orders.Db.sqlproj', 4]]);
});

test('a file that is not a solution, a broken Project line and too many projects are refused', () => {
  assert.throws(() => parseSln('<Project Sdk="Microsoft.NET.Sdk" />', 'x.sln'), /x\.sln: not a Visual Studio solution file/);
  assert.throws(() => parseSln('Microsoft Visual Studio Solution File, Format Version 12.00\nProject("{bad}") = "A"\n', 'y.sln'), /y\.sln: line 2: a Project entry that cannot be read/);
  const many = sln(Array.from({ length: 4 }, (_, i) => [`P${i}`, `p${i}\\P${i}.csproj`]));
  assert.throws(() => parseSln(many, 'z.sln', 3), /more than 3 projects/);
  assert.equal(parseSln(many, 'z.sln', 4).projects.length, 4);
});

test('path helpers normalise separators and recognise project files by extension, ignoring case', () => {
  assert.equal(toSlash('src\\Web\\Web.csproj'), 'src/Web/Web.csproj');
  assert.equal(toSlash('.\\a\\\\b.csproj'), 'a/b.csproj');
  assert.equal(toSlash('\\\\server\\share\\x.csproj'), '//server/share/x.csproj');
  assert.ok(isProjectPath('A/B.CSPROJ'));
  assert.ok(isProjectPath('b.vbproj') && isProjectPath('c.fsproj'));
  assert.ok(!isProjectPath('d.sqlproj'));
  assert.deepEqual(PROJECT_EXTENSIONS, ['.csproj', '.vbproj', '.fsproj']);
});
