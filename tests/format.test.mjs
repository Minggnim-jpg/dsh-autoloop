// Cards quote agents verbatim, and those quotes carry the console URLs the owner
// is meant to open. These lock the splitter: it must never lose a character and
// never swallow sentence punctuation into a link.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

await build({
  entryPoints: ['src/client/format.ts'],
  outfile: '.tmp-harness/format.mjs',
  bundle: true, format: 'esm', platform: 'node', target: 'node20', logLevel: 'warning',
})
const { splitLinks } = await import('../.tmp-harness/format.mjs')

/** Every case must round-trip: joining the pieces gives back the input exactly. */
function split(text) {
  const pieces = splitLinks(text)
  assert.equal(pieces.map((piece) => piece.value).join(''), text, `lossless: ${text}`)
  return pieces
}

function hrefs(text) {
  return split(text)
    .filter((piece) => piece.kind === 'link')
    .map((piece) => piece.href)
}

test('a bare URL in running text becomes a link', () => {
  const pieces = split('选品台：http://127.0.0.1:3354/test/picker.html\n回复“选择 N1”')
  assert.deepEqual(
    pieces.map((piece) => piece.kind),
    ['text', 'link', 'text'],
  )
  assert.equal(pieces[1].href, 'http://127.0.0.1:3354/test/picker.html')
})

test('www shorthand is promoted to https', () => {
  assert.deepEqual(hrefs('见 www.example.com/a?b=1 然后回复'), ['https://www.example.com/a?b=1'])
})

test('sentence punctuation stays outside the link', () => {
  assert.deepEqual(hrefs('draft 在 http://127.0.0.1:3354/draft-v1.html，请确认。'), ['http://127.0.0.1:3354/draft-v1.html'])
  assert.deepEqual(hrefs('open http://a.test/x.'), ['http://a.test/x'])
  assert.deepEqual(hrefs('open http://a.test/x)'), ['http://a.test/x'])
})

test('brackets that belong to the URL are kept', () => {
  assert.deepEqual(hrefs('(见 http://a.test/wiki/Foo_(bar))'), ['http://a.test/wiki/Foo_(bar)'])
  assert.deepEqual(hrefs('看 http://a.test/x《说明》'), ['http://a.test/x'])
})

test('several links in one body keep their order', () => {
  assert.deepEqual(hrefs('先 http://a.test/1 再 http://b.test/2'), ['http://a.test/1', 'http://b.test/2'])
})

test('prose without URLs is a single text piece', () => {
  assert.deepEqual(split('没有链接的一句话'), [{ kind: 'text', value: '没有链接的一句话' }])
  assert.deepEqual(splitLinks(''), [])
})

test('a scheme with no host is not a link', () => {
  assert.deepEqual(split('http://'), [{ kind: 'text', value: 'http://' }])
  assert.deepEqual(split('www.'), [{ kind: 'text', value: 'www.' }])
})
