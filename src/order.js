// The suggested move order: every project after the projects it references (a topological order), and among
// the projects that are ready at each step, libraries first (netstandard libraries before the others), then
// services, then web and desktop applications, then tests. Projects that reference each other in a loop
// cannot be ordered; each loop is returned, and its projects are listed last.

export const GROUPS = ['library', 'service', 'app', 'test'];

const SERVICES = ['WCF service', 'Web API', 'ASMX web service', 'Windows service', 'console'];

// The group of a project and its rank inside the order (lower moves earlier).
//   kind      a kind from guessKind
//   families  the families of its target frameworks (framework, netstandard, modern, unknown)
export function moveGroup(kind, families = []) {
  if (kind === 'test') return { group: 'test', rank: 4 };
  if (kind === 'class library') {
    const portable = families.length > 0 && families.every((f) => f === 'netstandard' || f === 'modern');
    return { group: 'library', rank: portable ? 0 : 1 };
  }
  if (SERVICES.includes(kind)) return { group: 'service', rank: 2 };
  return { group: 'app', rank: 3 };
}

function byRankThenName(a, b) {
  const x = a.name.toLowerCase();
  const y = b.name.toLowerCase();
  return a.rank - b.rank || (x < y ? -1 : x > y ? 1 : 0) || a.id - b.id;
}

// nodes: [{ id, name, rank, group, refs: [ids] }]. References to ids that are not nodes are ignored.
// Returns { order: [{ position, id, name, group, after: [names], cycle }], cycles: [[names]] }.
export function moveOrder(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const refs = new Map(nodes.map((n) => [n.id, [...new Set(n.refs)].filter((r) => byId.has(r))]));
  const waiting = new Map(nodes.map((n) => [n.id, refs.get(n.id).length]));
  const users = new Map(nodes.map((n) => [n.id, []]));
  for (const n of nodes) for (const r of refs.get(n.id)) users.get(r).push(n.id);

  const order = [];
  const placed = new Set();
  let ready = nodes.filter((n) => waiting.get(n.id) === 0);
  while (ready.length) {
    ready.sort(byRankThenName);
    const next = ready.shift();
    placed.add(next.id);
    order.push(next);
    for (const u of users.get(next.id)) {
      waiting.set(u, waiting.get(u) - 1);
      if (waiting.get(u) === 0) ready.push(byId.get(u));
    }
  }

  // Every project left over references another one left over, so following references from any of them
  // reaches a loop. Each loop is reported once.
  const left = nodes.filter((n) => !placed.has(n.id));
  const cycles = [];
  const inCycle = new Set();
  for (const start of [...left].sort(byRankThenName)) {
    if (inCycle.has(start.id)) continue;
    const path = [];
    const at = new Map();
    let current = start.id;
    while (!at.has(current)) {
      at.set(current, path.length);
      path.push(current);
      current = refs.get(current).find((r) => !placed.has(r));
    }
    const loop = path.slice(at.get(current));
    if (loop.some((id) => inCycle.has(id))) continue;
    for (const id of loop) inCycle.add(id);
    cycles.push(loop.map((id) => byId.get(id).name));
  }

  const result = [...order, ...left.sort(byRankThenName)].map((n, i) => ({
    position: i + 1,
    id: n.id,
    name: n.name,
    group: n.group,
    after: refs.get(n.id).map((r) => byId.get(r).name),
    cycle: !placed.has(n.id)
  }));
  return { order: result, cycles };
}
