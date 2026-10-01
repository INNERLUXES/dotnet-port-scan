// Report formats: text for a terminal, Markdown for a pull request or job summary, JSON for other tools,
// CSV for a spreadsheet.

function n(value) {
  return value.toLocaleString('en-US');
}

function plural(count, one, many = `${one}s`) {
  return `${n(count)} ${count === 1 ? one : many}`;
}

function projectsLine(r) {
  const s = r.summary;
  const parts = [`${n(s.oldStyle)} old-style`, `${n(s.sdkStyle)} SDK-style`];
  if (s.unreadable) parts.push(`${n(s.unreadable)} unreadable`);
  return `solutions: ${n(s.solutions)}; projects: ${n(s.projects)} (${parts.join(', ')})`;
}

function filesLine(r) {
  const f = r.summary.files;
  return `files: ${plural(f.webForms, 'Web Forms page')}, ${plural(f.userControls, 'user control')}, ${plural(f.masterPages, 'master page')}, ${n(f.globalAsax)} Global.asax, ${plural(f.wcf, 'WCF service')}, ${plural(f.asmx, 'ASMX service')}, ${plural(f.razor, 'Razor view')}, ${plural(f.code, 'code file')}`;
}

function findingSummary(r) {
  const shown = r.findings.length < r.total ? ` (showing ${n(r.findings.length)} of ${n(r.total)})` : '';
  return `${r.counts.error} error, ${r.counts.warning} warning, ${r.counts.info} info${shown}`;
}

function packagesCell(p) {
  return p.packages.length ? `${p.packages.length} (${p.packageSource})` : '-';
}

function projectRows(r) {
  return {
    head: ['Project', 'Style', 'Target', 'Kind', 'Packages', 'References'],
    rows: r.projects.map((p) => [p.name, p.style, p.targets.join(';') || '-', p.kind, packagesCell(p), p.projectReferences.join(', ') || '-'])
  };
}

function orderRows(r) {
  return {
    head: ['Step', 'Project', 'Group', 'After'],
    rows: r.order.map((o) => [String(o.position), o.name, o.cycle ? `${o.group} (in a loop)` : o.group, o.after.join(', ') || '-'])
  };
}

const ORDER_TITLE = 'Move order: each project after the projects it references; libraries first, then services, then apps, then tests';

function where(f) {
  return f.file ?? '-';
}

function textTable({ head, rows }) {
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((row) => String(row[i]).length)));
  const line = (cells) => cells.map((c, i) => (i === cells.length - 1 ? String(c) : String(c).padEnd(widths[i]))).join('  ').trimEnd();
  return [line(head), ...rows.map(line)];
}

export function toText(r) {
  const lines = [
    `dotnet-port-scan: ${r.input}`,
    projectsLine(r),
    filesLine(r),
    `findings: ${findingSummary(r)}`
  ];
  if (r.projects.length) lines.push('', ...textTable(projectRows(r)));
  if (r.order.length) lines.push('', ORDER_TITLE, ...textTable(orderRows(r)));
  if (!r.findings.length) lines.push('', 'no findings');
  for (const f of r.findings) lines.push('', `${f.severity.toUpperCase().padEnd(8)}  ${f.id.padEnd(19)}  ${where(f)}  ${f.message}`);
  if (r.notes.length) lines.push('');
  for (const note of r.notes) lines.push(`note: ${note}`);
  lines.push('', r.gate.pass ? `GATE: PASS (--fail-on ${r.gate.failOn})` : `GATE: FAIL - ${r.gate.reason}`);
  return lines.join('\n') + '\n';
}

// A Markdown table cell: backslashes and pipes escaped, line breaks flattened, so text from an input file
// cannot break the table.
export function mdCell(t) {
  return String(t).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n|\r/g, ' ');
}

function mdTable({ head, rows }) {
  return [
    `| ${head.map(mdCell).join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(mdCell).join(' | ')} |`)
  ];
}

export function toMarkdown(r) {
  const lines = [
    `## dotnet-port-scan: ${findingSummary(r)}`,
    '',
    `${mdCell(r.input)}: ${mdCell(projectsLine(r))}; ${mdCell(filesLine(r))}.`
  ];
  if (r.projects.length) lines.push('', ...mdTable(projectRows(r)));
  if (r.order.length) lines.push('', `${ORDER_TITLE}.`, '', ...mdTable(orderRows(r)));
  if (!r.findings.length) lines.push('', 'No findings.');
  else {
    lines.push('', '| Severity | Check | File | Message |', '| --- | --- | --- | --- |');
    for (const f of r.findings) lines.push(`| ${f.severity} | ${mdCell(f.id)} | ${mdCell(where(f))} | ${mdCell(f.message)} |`);
  }
  if (r.notes.length) lines.push('');
  for (const note of r.notes) lines.push(`- ${mdCell(note)}`);
  lines.push('', r.gate.pass ? `**Gate passed** (--fail-on ${r.gate.failOn}).` : `**Gate failed:** ${mdCell(r.gate.reason)}.`);
  return lines.join('\n') + '\n';
}

export function toJson(r) {
  return JSON.stringify(r, null, 2) + '\n';
}

// RFC 4180 quoting, and a leading quote on cells a spreadsheet would read as a formula.
export function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// One row per finding, then one per project, then one per step of the move order.
export function toCsv(r) {
  const rows = [['type', 'severity', 'id', 'project', 'file', 'message']];
  for (const f of r.findings) rows.push(['finding', f.severity, f.id, f.project, f.file, f.message]);
  for (const p of r.projects) rows.push(['project', '', p.kind, p.name, p.file, `${p.style}; ${p.targets.join(';') || '-'}; packages: ${packagesCell(p)}; references: ${p.projectReferences.join(', ') || '-'}`]);
  for (const o of r.order) rows.push(['order', '', String(o.position), o.name, '', `${o.group}${o.cycle ? ' (in a loop)' : ''}; after: ${o.after.join(', ') || '-'}`]);
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
