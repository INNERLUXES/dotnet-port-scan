// A small, strict XML reader for the files of a .NET solution: MSBuild project files, packages.config,
// web.config and app.config. It reads elements, attributes, text, CDATA sections, the five predefined
// entities and character references; comments, the XML declaration and processing instructions are skipped.
// A DOCTYPE or ENTITY declaration is refused before anything in it is read, so an input cannot define
// entities, expand them or point at another file. Anything that is not well-formed stops with the line.

export const XML_LIMITS = {
  maxDepth: 64,
  maxElements: 500_000
};

const NAME = /[A-Za-z_][A-Za-z0-9_.:-]*/y;
const PREDEFINED = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const SPACE = /[ \t\r\n]/;

function shown(text) {
  return String(text).replace(/[^ -~]/g, '?').slice(0, 40);
}

// An error that knows where in the text it happened, so the reader can give the line.
function fault(message, at) {
  const error = new Error(message);
  error.at = at;
  return error;
}

function codePoint(n, at) {
  if (!Number.isInteger(n) || n === 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) throw fault(`the character reference ${n} is not a valid character`, at);
  return String.fromCodePoint(n);
}

// Replaces &lt; &gt; &amp; &quot; &apos;, &#NNN; and &#xHHH;. Any other entity, and a bare "&", is refused:
// without a DOCTYPE no other entity can be defined, and a DOCTYPE is refused.
export function decodeEntities(raw) {
  const s = String(raw);
  if (!s.includes('&')) return s;
  let out = '';
  let i = 0;
  while (i < s.length) {
    const amp = s.indexOf('&', i);
    if (amp < 0) {
      out += s.slice(i);
      break;
    }
    out += s.slice(i, amp);
    const semi = s.indexOf(';', amp);
    if (semi < 0 || semi - amp > 10) throw fault('a bare "&" (write it as &amp;)', amp);
    const body = s.slice(amp + 1, semi);
    if (/^#x[0-9a-fA-F]{1,6}$/.test(body)) out += codePoint(parseInt(body.slice(2), 16), amp);
    else if (/^#[0-9]{1,7}$/.test(body)) out += codePoint(parseInt(body.slice(1), 10), amp);
    else if (Object.hasOwn(PREDEFINED, body)) out += PREDEFINED[body];
    else throw fault(`the entity &${shown(body)}; is not one of lt, gt, amp, quot, apos; other entities need a DOCTYPE, which is refused`, amp);
    i = semi + 1;
  }
  return out;
}

// Reads a whole document and returns its root element:
//   { name, attrs, children, text, line }
// attrs is an object without a prototype; text is the text directly inside the element, CDATA included.
export function parseXml(text, label = 'input', limits = XML_LIMITS) {
  const s = String(text).replace(/^\uFEFF/, '');
  let line = 1;
  let counted = 0;
  const lineAt = (pos) => {
    for (; counted < pos && counted < s.length; counted += 1) if (s.charCodeAt(counted) === 10) line += 1;
    return line;
  };
  const fail = (pos, message) => {
    throw new Error(`${label}: line ${lineAt(pos)}: ${message}`);
  };
  const decode = (pos, raw) => {
    try {
      return decodeEntities(raw);
    } catch (error) {
      return fail(pos + (error.at ?? 0), error.message);
    }
  };
  const stack = [];
  let root = null;
  let elements = 0;
  const addText = (pos, t) => {
    if (!stack.length) {
      if (/[^ \t\r\n]/.test(t)) fail(pos, 'text outside the root element');
      return;
    }
    stack[stack.length - 1].text += decode(pos, t);
  };
  const skipSpace = (j) => {
    while (j < s.length && SPACE.test(s[j])) j += 1;
    return j;
  };

  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt < 0) {
      addText(i, s.slice(i));
      break;
    }
    if (lt > i) addText(i, s.slice(i, lt));
    i = lt;
    if (s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i + 4);
      if (end < 0) fail(i, 'a comment is not closed');
      i = end + 3;
      continue;
    }
    if (s.startsWith('<![CDATA[', i)) {
      if (!stack.length) fail(i, 'a CDATA section outside the root element');
      const end = s.indexOf(']]>', i + 9);
      if (end < 0) fail(i, 'a CDATA section is not closed');
      stack[stack.length - 1].text += s.slice(i + 9, end);
      i = end + 3;
      continue;
    }
    if (s.startsWith('<!', i)) {
      const word = /^<!([A-Za-z]*)/.exec(s.slice(i, i + 12))[1].toUpperCase();
      if (word === 'DOCTYPE' || word === 'ENTITY') fail(i, `a ${word} declaration is refused: it can define entities that expand into large text or read other files, and project and config files do not need one`);
      fail(i, 'a declaration starting with "<!" is refused');
    }
    if (s.startsWith('<?', i)) {
      const end = s.indexOf('?>', i + 2);
      if (end < 0) fail(i, 'a processing instruction is not closed');
      i = end + 2;
      continue;
    }
    if (s.startsWith('</', i)) {
      NAME.lastIndex = i + 2;
      const m = NAME.exec(s);
      if (!m) fail(i, 'a closing tag without a name');
      const j = skipSpace(NAME.lastIndex);
      if (s[j] !== '>') fail(i, `the closing tag </${shown(m[0])}> is not closed`);
      const top = stack.pop();
      if (!top) fail(i, `</${shown(m[0])}> closes nothing`);
      if (top.name !== m[0]) fail(i, `</${shown(m[0])}> does not close <${shown(top.name)}> from line ${top.line}`);
      i = j + 1;
      continue;
    }
    NAME.lastIndex = i + 1;
    const m = NAME.exec(s);
    if (!m) fail(i, 'a "<" that does not start a tag (write it as &lt;)');
    const el = { name: m[0], attrs: Object.create(null), children: [], text: '', line: lineAt(i) };
    let j = NAME.lastIndex;
    let selfClosed = false;
    for (;;) {
      const before = j;
      j = skipSpace(j);
      if (j >= s.length) fail(i, `<${shown(el.name)}> is not closed`);
      if (s[j] === '>') {
        j += 1;
        break;
      }
      if (s.startsWith('/>', j)) {
        j += 2;
        selfClosed = true;
        break;
      }
      if (j === before) fail(j, `white space is needed before an attribute of <${shown(el.name)}>`);
      NAME.lastIndex = j;
      const a = NAME.exec(s);
      if (!a) fail(j, `a malformed attribute in <${shown(el.name)}>`);
      j = skipSpace(NAME.lastIndex);
      if (s[j] !== '=') fail(j, `the attribute ${shown(a[0])} has no value`);
      j = skipSpace(j + 1);
      const quote = s[j];
      if (quote !== '"' && quote !== "'") fail(j, `the value of ${shown(a[0])} is not in quotes`);
      const end = s.indexOf(quote, j + 1);
      if (end < 0) fail(j, `the value of ${shown(a[0])} is not closed`);
      const raw = s.slice(j + 1, end);
      if (raw.includes('<')) fail(j, `a "<" inside the value of ${shown(a[0])}`);
      if (a[0] in el.attrs) fail(j, `the attribute ${shown(a[0])} appears twice`);
      el.attrs[a[0]] = decode(j, raw).replace(/[\t\r\n]/g, ' ');
      j = end + 1;
    }
    elements += 1;
    if (elements > limits.maxElements) fail(i, `more than ${limits.maxElements.toLocaleString('en-US')} elements`);
    if (stack.length) stack[stack.length - 1].children.push(el);
    else if (root) fail(i, 'a second root element');
    else root = el;
    if (!selfClosed) {
      stack.push(el);
      if (stack.length > limits.maxDepth) fail(i, `elements nested more than ${limits.maxDepth} deep`);
    }
    i = j;
  }
  if (stack.length) {
    const open = stack[stack.length - 1];
    fail(s.length, `<${shown(open.name)}> from line ${open.line} is not closed`);
  }
  if (!root) fail(0, 'no root element');
  return root;
}

// The local name of an element or attribute, without a prefix, in lower case.
export function localName(name) {
  const n = String(name);
  return n.slice(n.indexOf(':') + 1).toLowerCase();
}

// The direct children with this local name, compared ignoring case.
export function childElements(el, name) {
  const want = String(name).toLowerCase();
  return el.children.filter((c) => localName(c.name) === want);
}

// Every element below el with this local name (ignoring case), in document order. Elements for which
// skip(element) is true are not searched.
export function findElements(el, name, skip = () => false) {
  const want = String(name).toLowerCase();
  const out = [];
  const stack = [...el.children].reverse();
  while (stack.length) {
    const e = stack.pop();
    if (skip(e)) continue;
    if (localName(e.name) === want) out.push(e);
    for (let k = e.children.length - 1; k >= 0; k -= 1) stack.push(e.children[k]);
  }
  return out;
}

// The value of an attribute, found ignoring case, or null.
export function attr(el, name) {
  const want = String(name).toLowerCase();
  for (const k of Object.keys(el.attrs)) if (k.toLowerCase() === want) return el.attrs[k];
  return null;
}

// The text of an element with white space at both ends removed.
export function textOf(el) {
  return el.text.trim();
}
