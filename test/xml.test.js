import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseXml, decodeEntities, localName, childElements, findElements, attr, textOf, XML_LIMITS } from '../src/index.js';

test('reads elements, attributes, text and line numbers', () => {
  const root = parseXml('<?xml version="1.0"?>\n<a x="1" y=\'two\'>\n  <b>hello</b>\n  <c z="3"/>\n  <b>again</b>\n</a>\n', 'f.xml');
  assert.equal(root.name, 'a');
  assert.deepEqual({ ...root.attrs }, { x: '1', y: 'two' });
  assert.deepEqual(root.children.map((c) => [c.name, c.line, textOf(c)]), [['b', 3, 'hello'], ['c', 4, ''], ['b', 5, 'again']]);
  assert.equal(root.line, 2);
});

test('decodes the five XML entities and character references, and refuses everything else', () => {
  assert.equal(decodeEntities('a &lt;b&gt; &amp; &quot;c&quot; &apos;d&apos; &#65;&#x42;'), 'a <b> & "c" \'d\' AB');
  assert.equal(decodeEntities('plain'), 'plain');
  assert.throws(() => decodeEntities('&nbsp;'), /not one of lt, gt, amp, quot, apos/);
  assert.throws(() => decodeEntities('a & b'), /bare "&"/);
  assert.throws(() => decodeEntities('&#0;'), /not a valid character/);
  assert.throws(() => decodeEntities('&#xD800;'), /not a valid character/);
  const root = parseXml('<a v="x &amp; y">1 &lt; 2</a>');
  assert.equal(root.attrs.v, 'x & y');
  assert.equal(root.text, '1 < 2');
  assert.throws(() => parseXml('<a>\n&custom;</a>', 'p.csproj'), /p\.csproj: line 2: the entity &custom;/);
});

test('a DOCTYPE or ENTITY declaration is refused before anything in it is read', () => {
  const bomb = '<?xml version="1.0"?>\n<!DOCTYPE lolz [\n <!ENTITY lol "lol">\n <!ENTITY lol2 "&lol;&lol;&lol;&lol;">\n]>\n<lolz>&lol2;</lolz>';
  assert.throws(() => parseXml(bomb, 'bomb.csproj'), /bomb\.csproj: line 2: a DOCTYPE declaration is refused/);
  assert.throws(() => parseXml('<!doctype x SYSTEM "file:///etc/passwd"><x/>'), /DOCTYPE declaration is refused/);
  assert.throws(() => parseXml('<!ENTITY e "x"><a/>'), /an? ENTITY declaration is refused/);
  assert.throws(() => parseXml('<a><!ELEMENT a ANY></a>'), /declaration starting with "<!" is refused/);
});

test('comments, the XML declaration and processing instructions are skipped; CDATA is text', () => {
  const root = parseXml('\uFEFF<?xml version="1.0" encoding="utf-8"?>\r\n<!-- a <b> comment -->\r\n<a><?pi data?><!-- x --><![CDATA[1 < 2 && <b>]]> and more</a><!-- after -->\r\n');
  assert.equal(root.text, '1 < 2 && <b> and more');
  assert.equal(root.children.length, 0);
});

test('malformed documents stop with the line', () => {
  const bad = [
    ['<a><b></a>', /line 1: <\/a> does not close <b> from line 1/],
    ['<a>\n<b>', /line 2: <b> from line 2 is not closed/],
    ['<a/><b/>', /a second root element/],
    ['text<a/>', /text outside the root element/],
    ['<a x="1" x="2"/>', /the attribute x appears twice/],
    ['<a x=1/>', /the value of x is not in quotes/],
    ['<a x="<"/>', /"<" inside the value of x/],
    ['<a x="1"y="2"/>', /white space is needed before an attribute/],
    ['<a><!-- open</a>', /a comment is not closed/],
    ['<a><![CDATA[x</a>', /a CDATA section is not closed/],
    ['<a>1 < 2</a>', /does not start a tag/],
    ['</a>', /closes nothing/],
    ['', /no root element/],
    ['<a', /<a> is not closed/]
  ];
  for (const [text, message] of bad) assert.throws(() => parseXml(text, 'bad.xml'), message, text);
});

test('nesting depth and element count are limited', () => {
  const deep = '<a>'.repeat(XML_LIMITS.maxDepth + 1) + '</a>'.repeat(XML_LIMITS.maxDepth + 1);
  assert.throws(() => parseXml(deep), /nested more than 64 deep/);
  const ok = '<a>'.repeat(XML_LIMITS.maxDepth) + '</a>'.repeat(XML_LIMITS.maxDepth);
  assert.equal(parseXml(ok).name, 'a');
  assert.throws(() => parseXml(`<a>${'<b/>'.repeat(10)}</a>`, 'many.xml', { ...XML_LIMITS, maxElements: 5 }), /more than 5 elements/);
});

test('lookups ignore case and prefixes; attribute names cannot reach a prototype', () => {
  const root = parseXml('<Project><propertygroup><TargetFramework>net48</TargetFramework></propertygroup><x:ItemGroup><Reference Include="System.Web"/></x:ItemGroup><Target><ItemGroup><Reference Include="Hidden"/></ItemGroup></Target></Project>');
  assert.equal(localName('x:ItemGroup'), 'itemgroup');
  assert.equal(childElements(root, 'PropertyGroup').length, 1);
  assert.deepEqual(findElements(root, 'Reference').map((e) => attr(e, 'include')), ['System.Web', 'Hidden']);
  assert.deepEqual(findElements(root, 'Reference', (e) => localName(e.name) === 'target').map((e) => attr(e, 'INCLUDE')), ['System.Web']);
  assert.equal(attr(root, 'Sdk'), null);
  const evil = parseXml('<a __proto__="x" constructor="y" toString="z"/>');
  assert.equal(evil.attrs.__proto__, 'x');
  assert.equal(Object.getPrototypeOf(evil.attrs), null);
  assert.equal({}.polluted, undefined);
});

test('white space inside attribute values is normalised; text keeps line breaks', () => {
  const root = parseXml('<a v="one\r\ntwo\tthree">x\ny</a>');
  assert.equal(root.attrs.v, 'one  two three');
  assert.equal(root.text, 'x\ny');
});
