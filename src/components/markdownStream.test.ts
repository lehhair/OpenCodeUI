import { describe, expect, it } from 'vitest'
import { projectMarkdownStream, splitMarkdownStream } from './markdownStream'

describe('splitMarkdownStream', () => {
  it('splits non-streaming markdown into full and code blocks', () => {
    expect(splitMarkdownStream('before\n\n```ts\nconst x = 1', false)).toEqual([
      expect.objectContaining({ src: 'before\n\n', mode: 'full' }),
      expect.objectContaining({ src: 'const x = 1', raw: '```ts\nconst x = 1', mode: 'code', language: 'ts' }),
    ])
  })

  it('keeps incomplete single-block streaming markdown as one live block', () => {
    expect(splitMarkdownStream('hello **world', true)).toEqual([
      expect.objectContaining({ src: 'hello **world', mode: 'live' }),
    ])
  })

  it('keeps the single live block key stable while streaming grows', () => {
    const first = splitMarkdownStream('```md\n# title', true)
    const next = splitMarkdownStream('```md\n# title\n\n- item', true)

    expect(first).toHaveLength(1)
    expect(next).toHaveLength(1)
    expect(first[0].key).toBe(next[0].key)
    expect(next[0]).toEqual(expect.objectContaining({ mode: 'code', language: 'md', src: '# title\n\n- item' }))
  })

  it('splits stable paragraphs from the live tail while streaming', () => {
    expect(splitMarkdownStream('first paragraph\n\nsecond **live', true)).toEqual([
      expect.objectContaining({ src: 'first paragraph\n\n', mode: 'full' }),
      expect.objectContaining({ src: 'second **live', mode: 'live' }),
    ])
  })

  it('keeps the stable paragraph key while only the live tail grows', () => {
    const first = splitMarkdownStream('first paragraph\n\nsecond', true)
    const next = splitMarkdownStream('first paragraph\n\nsecond grows', true)

    expect(first[0].key).toBe(next[0].key)
    expect(first[0].src).toBe(next[0].src)
    expect(first[1].key).toBe(next[1].key)
    expect(first[1].src).not.toBe(next[1].src)
  })

  it('keeps multiple completed blocks stable while only the tail is live', () => {
    expect(splitMarkdownStream('one\n\ntwo\n\nthree live', true)).toEqual([
      expect.objectContaining({ src: 'one\n\n', mode: 'full' }),
      expect.objectContaining({ src: 'two\n\n', mode: 'full' }),
      expect.objectContaining({ src: 'three live', mode: 'live' }),
    ])
  })

  it('does not split on blank lines inside fenced code blocks', () => {
    expect(splitMarkdownStream('before\n\n```ts\nconst a = 1\n\nconst b = 2\n```\n\nafter', true)).toEqual([
      expect.objectContaining({ src: 'before\n\n', mode: 'full' }),
      expect.objectContaining({
        src: 'const a = 1\n\nconst b = 2',
        raw: '```ts\nconst a = 1\n\nconst b = 2\n```\n\n',
        mode: 'code',
        complete: true,
      }),
      expect.objectContaining({ src: 'after', mode: 'live' }),
    ])
  })

  it('splits stable content from an unfinished trailing code fence while streaming', () => {
    expect(splitMarkdownStream('before\n\n```ts\nconst x = 1', true)).toEqual([
      expect.objectContaining({ src: 'before\n\n', mode: 'full' }),
      expect.objectContaining({ src: 'const x = 1', raw: '```ts\nconst x = 1', mode: 'code', complete: false }),
    ])
  })

  it('keeps the stable block key while the trailing code fence grows', () => {
    const first = splitMarkdownStream('before\n\n```ts\nconst x = 1', true)
    const next = splitMarkdownStream('before\n\n```ts\nconst x = 12', true)

    expect(first[0].key).toBe(next[0].key)
    expect(first[0].src).toBe(next[0].src)
    expect(first[1].key).toBe(next[1].key)
    expect(first[1].src).not.toBe(next[1].src)
    expect(next[1].src).toBe('const x = 12')
  })

  it('splits stable content before a completed code fence while streaming', () => {
    expect(splitMarkdownStream('before\n\n```ts\nconst x = 1\n```', true)).toEqual([
      expect.objectContaining({ src: 'before\n\n', mode: 'full' }),
      expect.objectContaining({ src: 'const x = 1', raw: '```ts\nconst x = 1\n```', mode: 'code', complete: true }),
    ])
  })

  it('keeps reference-style markdown as one live block', () => {
    expect(splitMarkdownStream('[docs][1]\n\n[1]: https://example.com', true)).toEqual([
      expect.objectContaining({ src: '[docs][1]\n\n[1]: https://example.com', mode: 'live' }),
    ])
  })

  it('does not treat footnotes as reference definitions that disable block splitting', () => {
    expect(splitMarkdownStream('text[^ref]\n\n[^ref]: footnote\n\n```ts\nconst x = 1\n```', false)).toEqual([
      expect.objectContaining({ src: 'text[^ref]\n\n', mode: 'full' }),
      expect.objectContaining({ src: '[^ref]: footnote\n\n', mode: 'full' }),
      expect.objectContaining({ src: 'const x = 1', raw: '```ts\nconst x = 1\n```', mode: 'code', language: 'ts' }),
    ])
  })

  it('keeps reference-style live block key stable while streaming grows', () => {
    const first = splitMarkdownStream('[docs][1]\n\n[1]: https://example.com', true)
    const next = splitMarkdownStream('[docs][1]\n\n[1]: https://example.com "title"', true)

    expect(first[0].key).toBe(next[0].key)
  })

  it('does not append reference definitions to standalone display math blocks', () => {
    const markdown = String.raw`[docs][1]

$$
\begin{aligned}
a &= b \\
c &= d
\end{aligned}
$$

[1]: https://example.com`
    const blocks = splitMarkdownStream(markdown, false)
    const mathBlock = blocks.find(block => block.src.trimStart().startsWith('$$'))

    expect(mathBlock?.src.trim()).toBe(String.raw`$$
\begin{aligned}
a &= b \\
c &= d
\end{aligned}
$$`)
  })

  it('keeps HTML block identity when streaming completes', () => {
    const markdown = '<details><summary>More</summary><input value="draft"></details>'

    expect(splitMarkdownStream(markdown, true)[0].key).toBe(splitMarkdownStream(markdown, false)[0].key)
  })

  it('keeps Markdown nested in block HTML inside one DOM island', () => {
    const markdown = `<details>
<summary>More</summary>

**bold**

| A | B |
|---|---|
| 1 | 2 |

</details>`
    const blocks = splitMarkdownStream(markdown, false)

    expect(blocks).toHaveLength(1)
    expect(blocks[0].mode).toBe('full')
    expect(blocks[0].src).toContain('**bold**')
    expect(blocks[0].src).toContain('| A | B |')
  })

  it('keeps a doctype and its HTML document in one block', () => {
    const markdown = '<!doctype html>\n<html><body><h1>Hello</h1></body></html>'
    const blocks = splitMarkdownStream(markdown, false)

    expect(blocks).toHaveLength(1)
    expect(blocks[0].src).toBe(markdown)
  })

  it('keeps adjacent style, markup, and script HTML in one artifact block', () => {
    const markdown = `<style>
.apple-clock { color: red; }
</style>

<div class="apple-clock">12:00</div>

<script>document.querySelector('.apple-clock').dataset.ready = 'true'</script>`

    for (const isStreaming of [true, false]) {
      const blocks = splitMarkdownStream(markdown, isStreaming)
      expect(blocks).toHaveLength(1)
      expect(blocks[0].src).toBe(markdown)
    }
  })

  it('keeps a prefixed style, bare SVG, and trailing script in one artifact block', () => {
    const markdown = `<style>.diagram { color: red; }</style>

<svg class="diagram"><text>diagram</text></svg>

<script>document.querySelector('.diagram').dataset.ready = 'true'</script>`

    for (const isStreaming of [true, false]) {
      const blocks = splitMarkdownStream(markdown, isStreaming)
      expect(blocks).toHaveLength(1)
      expect(blocks[0].src).toBe(markdown)
    }
  })

  it('stops a prefixed artifact before independent HTML after its trailing script', () => {
    const artifact = `<style>.diagram { color: red; }</style>

<svg class="diagram"><text>diagram</text></svg>

<script>document.querySelector('.diagram').dataset.ready = 'true'</script>`
    const blocks = splitMarkdownStream(`${artifact}\n\n<section>independent</section>`, false)

    expect(blocks).toHaveLength(2)
    expect(blocks[0].src.trimEnd()).toBe(artifact)
    expect(blocks[1].src).toBe('<section>independent</section>')
  })

  it('recognizes a prefixed artifact after a leading HTML comment', () => {
    const markdown = `<!-- diagram -->
<style>.diagram { color: red; }</style>

<svg class="diagram"><text>diagram</text></svg>

<script>document.querySelector('.diagram').dataset.ready = 'true'</script>`

    expect(splitMarkdownStream(markdown, false)).toEqual([expect.objectContaining({ src: markdown, mode: 'full' })])
  })

  it('keeps a styled SVG wrapper intact and stops before following Markdown', () => {
    const artifact = `<div style="font-family:sans-serif;">
<style>
:root { --surface: #fff; }
</style>

<svg width="100%" viewBox="0 0 680 460">
  <!-- diagram title -->
  <text x="40" y="30">微服务架构</text>
</svg>
</div>`
    const markdown = `${artifact}\n\n再来个交付时间线`

    for (const isStreaming of [true, false]) {
      const blocks = splitMarkdownStream(markdown, isStreaming)
      expect(blocks).toHaveLength(2)
      expect(blocks[0].src.trimEnd()).toBe(artifact)
      expect(blocks[1].src).toBe('再来个交付时间线')
    }
  })

  it('ignores apparent container tags inside scripts when finding the artifact boundary', () => {
    const artifact = `<div><script>const template = '<section>not markup</section>'</script><canvas></canvas></div>`
    const blocks = splitMarkdownStream(`${artifact}\n\nafter`, false)

    expect(blocks).toHaveLength(2)
    expect(blocks[0].src.trimEnd()).toBe(artifact)
    expect(blocks[1].src).toBe('after')
  })

  it('does not treat similar raw-text closing names as script or style boundaries', () => {
    const artifact = `<div><script>const template = '</scripture><section>'</script><style>.x::after{content:'</stylesheet><div>'}</style></div>`
    const blocks = splitMarkdownStream(`${artifact}\n\nafter`, false)

    expect(blocks).toHaveLength(2)
    expect(blocks[0].src.trimEnd()).toBe(artifact)
    expect(blocks[1].src).toBe('after')
  })

  it('ignores container-like text inside textarea and title elements', () => {
    const artifact = `<div><textarea>literal </div></textarea><title>also </section></title><svg></svg></div>`
    const blocks = splitMarkdownStream(`${artifact}\n\nafter`, false)

    expect(blocks).toHaveLength(2)
    expect(blocks[0].src.trimEnd()).toBe(artifact)
    expect(blocks[1].src).toBe('after')
  })

  it('ignores container-like markup inside comments split across Markdown blocks', () => {
    const artifact = `<div>
<!--

</div>

inside comment
-->
<svg><text>diagram</text></svg>
</div>`
    const blocks = splitMarkdownStream(`${artifact}\n\nafter`, false)

    expect(blocks).toHaveLength(2)
    expect(blocks[0].src.trimEnd()).toBe(artifact)
    expect(blocks[1].src).toBe('after')
  })

  it('stops an artifact at its root closing tag within the same Markdown token', () => {
    const blocks = splitMarkdownStream('<div><svg></svg></div>\n# after', false)

    expect(blocks).toHaveLength(2)
    expect(blocks[0].src).toBe('<div><svg></svg></div>')
    expect(blocks[1].src).toBe('\n# after')
  })

  it('recognizes a bare SVG as one HTML artifact', () => {
    const svg = '<svg viewBox="0 0 100 100"><text>diagram</text></svg>'

    expect(splitMarkdownStream(svg, false)).toEqual([expect.objectContaining({ src: svg, mode: 'full' })])
  })

  it('keeps an HTML fence key stable when the stream closes', () => {
    const open = splitMarkdownStream('```html\n<div>live</div>', true)
    const complete = splitMarkdownStream('```html\n<div>live</div>\n```', true)
    const settled = splitMarkdownStream('```html\n<div>live</div>\n```', false)

    expect(open[0].key).toBe(complete[0].key)
    expect(complete[0].key).toBe(settled[0].key)
  })

  it.each(['svg', 'xml', 'xhtml'])('keeps a %s preview key stable when the stream closes', language => {
    const open = splitMarkdownStream(`\`\`\`${language}\n<svg><text>live</text></svg>`, true)
    const complete = splitMarkdownStream(`\`\`\`${language}\n<svg><text>live</text></svg>\n\`\`\``, true)
    const settled = splitMarkdownStream(`\`\`\`${language}\n<svg><text>live</text></svg>\n\`\`\``, false)

    expect(open[0].key).toBe(complete[0].key)
    expect(complete[0].key).toBe(settled[0].key)
  })

  it('projects appended open code fences without rebuilding stable blocks', () => {
    const first = projectMarkdownStream(undefined, 'before\n\n```ts\nconst x = 1', true)
    const next = projectMarkdownStream(first, 'before\n\n```ts\nconst x = 12', true)

    expect(next.blocks).toHaveLength(2)
    expect(next.blocks[0]).toBe(first.blocks[0])
    expect(next.blocks[1].key).toBe(first.blocks[1].key)
    expect(next.blocks[1].src).toBe('const x = 12')
    expect(next.blocks[1].raw).toBe('```ts\nconst x = 12')
  })

  it('falls back to full splitting when appended text closes an open code fence', () => {
    const first = projectMarkdownStream(undefined, 'before\n\n```ts\nconst x = 1', true)
    const next = projectMarkdownStream(first, 'before\n\n```ts\nconst x = 1\n```', true)

    expect(next.blocks).toEqual(splitMarkdownStream('before\n\n```ts\nconst x = 1\n```', true))
  })

  it('projects pure live-tail append without rebuilding stable blocks', () => {
    const first = projectMarkdownStream(undefined, 'hello', true)
    const next = projectMarkdownStream(first, 'hello world', true)

    expect(next.blocks).toHaveLength(1)
    expect(next.blocks[0].mode).toBe('live')
    expect(next.blocks[0].src).toBe('hello world')
  })

  it('keeps earlier full blocks by reference when live tail appends text', () => {
    const first = projectMarkdownStream(undefined, 'stable paragraph\n\nlive', true)
    expect(first.blocks.length).toBeGreaterThanOrEqual(2)
    const next = projectMarkdownStream(first, 'stable paragraph\n\nlive tail', true)

    expect(next.blocks[0]).toBe(first.blocks[0])
    expect(next.blocks.at(-1)?.mode).toBe('live')
    expect(next.blocks.at(-1)?.src).toContain('live tail')
  })

  it('falls back to full splitting when live suffix opens a new block boundary', () => {
    const first = projectMarkdownStream(undefined, 'hello', true)
    const next = projectMarkdownStream(first, 'hello\n\n## Title', true)

    expect(next.blocks).toEqual(splitMarkdownStream('hello\n\n## Title', true))
  })

  it('falls back when live suffix starts a list after a newline', () => {
    const first = projectMarkdownStream(undefined, 'intro', true)
    const next = projectMarkdownStream(first, 'intro\n- item', true)

    expect(next.blocks).toEqual(splitMarkdownStream('intro\n- item', true))
  })
})
