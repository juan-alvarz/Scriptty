// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderMarkdown, repoBase, safeUrl } from './markdown'

const REPO = 'https://github.com/acme/widget'

/** Parses rendered output so assertions look at the DOM, not at string formatting. */
const dom = (md: string, repo = REPO): HTMLElement => {
  const div = document.createElement('div')
  div.innerHTML = renderMarkdown(md, repo)
  return div
}

describe('renderMarkdown sanitizing', () => {
  it('removes script tags and their content', () => {
    const el = dom('Hi\n\n<script>alert(1)</script>\n\n<p>ok<script src="https://x.test/a.js"></script></p>')
    expect(el.querySelector('script')).toBeNull()
    expect(el.textContent).not.toContain('alert')
    expect(el.textContent).toContain('ok')
  })

  it('removes on* handlers', () => {
    const el = dom('<a href="https://ok.test" onclick="alert(1)" onmouseover="x()">x</a> <p onload="y()">p</p> <details ontoggle="z()" open>d</details>')
    for (const node of el.querySelectorAll('*'))
      for (const attr of node.attributes) expect(attr.name.startsWith('on'), `${node.tagName} ${attr.name}`).toBe(false)
    expect(el.querySelector('a')?.getAttribute('href')).toBe('https://ok.test/')
  })

  it('drops javascript:, data:, vbscript: and file: links, however they are spelled', () => {
    const el = dom(
      [
        '[a](javascript:alert(1))',
        '<a href="JaVaScRiPt:alert(1)">b</a>',
        '<a href="java&#x09;script:alert(1)">c</a>',
        '<a href=" javascript:alert(1)">d</a>',
        '[e](data:text/html;base64,PHNjcmlwdD4=)',
        '<a href="vbscript:msgbox(1)">f</a>',
        '[g](file:///etc/passwd)',
        '[h](mailto:a@b.test)'
      ].join('\n\n')
    )
    const links = [...el.querySelectorAll('a')]
    expect(links).toHaveLength(8)
    for (const a of links) expect(a.hasAttribute('href'), a.outerHTML).toBe(false)
    expect(el.textContent).toContain('a')
  })

  it('removes iframes, forms, styles, objects, svg and non-checkbox inputs', () => {
    const el = dom(
      '<iframe src="https://x.test"></iframe><form action="https://x.test"><input name="q"><button>Go</button></form>' +
        '<style>body{display:none}</style><object data="x"></object><embed src="x"><svg><script>1</script></svg>' +
        '<link rel="stylesheet" href="https://x.test/a.css"><meta http-equiv="refresh" content="0;url=https://x.test">'
    )
    for (const tag of ['iframe', 'form', 'input', 'button', 'style', 'object', 'embed', 'svg', 'link', 'meta'])
      expect(el.querySelector(tag), tag).toBeNull()
  })

  it('strips style, class, id and data attributes', () => {
    const el = dom('<div class="drag" style="position:fixed;inset:0" id="app" data-x="1">x</div>')
    const div = el.querySelector('div')!
    expect(div.attributes).toHaveLength(0)
  })

  it('replaces every image with its alt text, linked only when the source is https', () => {
    const el = dom(
      [
        '![https logo](https://cdn.test/logo.png)',
        '![plain http](http://cdn.test/a.png)',
        '![data uri](data:image/png;base64,iVBORw0KGgo=)',
        '![js](javascript:alert(1))',
        '<img src="x" onerror="alert(1)">',
        '[![badge](https://img.test/b.svg)](https://ci.test)'
      ].join('\n\n')
    )
    expect(el.querySelector('img')).toBeNull()
    const labels = [...el.querySelectorAll('.md-img')].map((s) => [s.textContent, s.closest('a')?.getAttribute('href') ?? null])
    expect(labels).toEqual([
      ['https logo', 'https://cdn.test/logo.png'],
      ['plain http', 'https://cdn.test/a.png'],
      ['data uri', null],
      ['js', null],
      ['badge', 'https://ci.test/']
    ])
  })

  it('keeps GFM task list checkboxes, disabled', () => {
    const boxes = [...dom('- [x] done\n- [ ] todo').querySelectorAll('input')]
    expect(boxes.map((b) => [b.type, b.checked, b.disabled])).toEqual([
      ['checkbox', true, true],
      ['checkbox', false, true]
    ])
  })
})

describe('renderMarkdown output', () => {
  it('renders headings with anchors, code blocks with their language, tables, quotes and lists', () => {
    const el = dom(
      '# Widget\n\n## Get started!\n\n## Get started!\n\n```ts\nconst a = 1 < 2\n```\n\n| a | b |\n|---|:-:|\n| 1 | 2 |\n\n> quoted\n\n1. one\n2. two\n\n`inline`'
    )
    expect([...el.querySelectorAll('h1, h2')].map((h) => [h.tagName, h.getAttribute('data-slug')])).toEqual([
      ['H1', 'widget'],
      ['H2', 'get-started'],
      ['H2', 'get-started-1']
    ])
    const code = el.querySelector('pre > code')!
    expect(code.getAttribute('data-lang')).toBe('ts')
    expect(code.textContent).toBe('const a = 1 < 2\n')
    expect(el.querySelectorAll('table th')).toHaveLength(2)
    expect(el.querySelector('td')?.textContent).toBe('1')
    expect(el.querySelector('blockquote')?.textContent?.trim()).toBe('quoted')
    expect(el.querySelectorAll('ol > li')).toHaveLength(2)
    expect(el.querySelector('p > code')?.textContent).toBe('inline')
  })

  it('keeps in-page anchors and resolves relative links against the repository', () => {
    const el = dom('[toc](#get-started) [docs](docs/api.md) [root](/LICENSE) [up](./x/../y.md) ![shot](img/s.png)')
    const hrefs = [...el.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual([
      '#get-started',
      'https://github.com/acme/widget/blob/HEAD/docs/api.md',
      'https://github.com/acme/widget/blob/HEAD/LICENSE',
      'https://github.com/acme/widget/blob/HEAD/y.md',
      'https://raw.githubusercontent.com/acme/widget/HEAD/img/s.png'
    ])
  })

  it('drops relative links when the repository host is unknown', () => {
    const el = dom('[docs](docs/api.md) [abs](https://ok.test/a)', 'https://example.test/acme/widget')
    expect([...el.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([null, 'https://ok.test/a'])
  })
})

describe('URL helpers', () => {
  it('knows GitHub and GitLab layouts', () => {
    expect(repoBase('https://github.com/a/b.git')?.link).toBe('https://github.com/a/b/blob/HEAD/')
    expect(repoBase('https://github.com/a/b#readme')?.image).toBe('https://raw.githubusercontent.com/a/b/HEAD/')
    expect(repoBase('https://gitlab.com/a/b')?.link).toBe('https://gitlab.com/a/b/-/blob/HEAD/')
    expect(repoBase('https://example.test/a/b')).toBeNull()
    expect(repoBase('')).toBeNull()
  })

  it('returns only https URLs', () => {
    expect(safeUrl('http://a.test/x', null)).toBe('https://a.test/x')
    expect(safeUrl('//a.test/x', null)).toBe('https://a.test/x')
    expect(safeUrl('java\nscript:alert(1)', 'https://github.com/a/b/blob/HEAD/')).toBeNull()
    expect(safeUrl('ftp://a.test', null)).toBeNull()
    expect(safeUrl('docs/x.md', null)).toBeNull()
    expect(safeUrl('#x', 'https://a.test/')).toBeNull()
  })
})
