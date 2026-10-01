import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveOrder, moveGroup, GROUPS } from '../src/index.js';

const node = (id, name, kind, refs = [], families = ['framework']) => ({ id, name, refs, ...moveGroup(kind, families) });
const names = (r) => r.order.map((o) => o.name);

test('groups: portable libraries, other libraries, services, apps, tests', () => {
  assert.deepEqual(GROUPS, ['library', 'service', 'app', 'test']);
  assert.deepEqual(moveGroup('class library', ['netstandard']), { group: 'library', rank: 0 });
  assert.deepEqual(moveGroup('class library', ['framework', 'netstandard']), { group: 'library', rank: 1 });
  assert.deepEqual(moveGroup('class library', []), { group: 'library', rank: 1 });
  for (const kind of ['WCF service', 'Web API', 'ASMX web service', 'Windows service', 'console']) assert.equal(moveGroup(kind).group, 'service', kind);
  for (const kind of ['Web Forms', 'MVC', 'ASP.NET Core web', 'web application', 'desktop (WPF)']) assert.equal(moveGroup(kind).group, 'app', kind);
  assert.deepEqual(moveGroup('test'), { group: 'test', rank: 4 });
});

test('with no references between them: libraries first (netstandard before net4x), then services, apps and tests', () => {
  const r = moveOrder([
    node(0, 'Web', 'Web Forms'),
    node(1, 'Tests', 'test'),
    node(2, 'Svc', 'WCF service'),
    node(3, 'Core', 'class library'),
    node(4, 'Contracts', 'class library', [], ['netstandard']),
    node(5, 'Admin', 'MVC')
  ]);
  assert.deepEqual(names(r), ['Contracts', 'Core', 'Svc', 'Admin', 'Web', 'Tests']);
  assert.deepEqual(r.order.map((o) => o.position), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(r.cycles, []);
});

test('references come first, even when that moves a project out of its group', () => {
  const r = moveOrder([
    node(0, 'Lib', 'class library', [1]),
    node(1, 'Hosting', 'Windows service'),
    node(2, 'Web', 'Web Forms', [0, 0, 99]),
    node(3, 'Other', 'class library')
  ]);
  assert.deepEqual(names(r), ['Other', 'Hosting', 'Lib', 'Web']);
  assert.deepEqual(r.order.find((o) => o.name === 'Web').after, ['Lib']);
  assert.equal(r.order.every((o) => o.cycle === false), true);
});

test('loops are reported once each and their projects are listed last; projects that depend on a loop wait too', () => {
  const r = moveOrder([
    node(0, 'A', 'class library', [1]),
    node(1, 'B', 'class library', [0]),
    node(2, 'C', 'Web Forms', [0]),
    node(3, 'D', 'class library'),
    node(4, 'Self', 'console', [4]),
    node(5, 'E', 'class library', [6]),
    node(6, 'F', 'class library', [7]),
    node(7, 'G', 'class library', [5])
  ]);
  assert.deepEqual(names(r), ['D', 'A', 'B', 'E', 'F', 'G', 'Self', 'C']);
  assert.deepEqual(r.cycles, [['A', 'B'], ['E', 'F', 'G'], ['Self']]);
  assert.deepEqual(r.order.filter((o) => o.cycle).map((o) => o.name), ['A', 'B', 'E', 'F', 'G', 'Self', 'C']);
});

test('names that sort the same keep a stable order by id', () => {
  const r = moveOrder([node(1, 'lib', 'class library'), node(0, 'Lib', 'class library'), node(2, 'aLib', 'class library')]);
  assert.deepEqual(r.order.map((o) => o.id), [2, 0, 1]);
  assert.deepEqual(moveOrder([]).order, []);
});
