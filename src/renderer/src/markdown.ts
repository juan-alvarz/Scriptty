import DOMPurify from 'dompurify'
import { Marked } from 'marked'

// Package READMEs are untrusted. marked turns Markdown (and any raw HTML in it) into HTML, DOMPurify keeps only
// the tags and attributes below, then `tidy` fixes up URLs and images on an inert copy (decision 17).
const TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'div', 'span',
  'a', 'strong', 'b', 'em', 'i', 'del', 's', 'u', 'mark', 'small', 'sup', 'sub', 'kbd', 'code', 'pre', 'samp',
  'blockquote', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'details', 'summary',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  'img', 'input'
]
// `class` is read by `tidy` (for the code block language) and then removed: README classes could reuse the app's
// own (`.drag` makes a region drag the window). No `style`, `id` or `name`.
const ATTRS = ['href', 'src', 'alt', 'title', 'align', 'colspan', 'rowspan', 'start', 'type', 'checked', 'open', 'class']

const marked = new Marked({ gfm: true, async: false })
let purify: ReturnType<typeof DOMPurify> | null = null

/** Where relative README links and images point, for repositories whose URL layout we know. */
export function repoBase(repository: string): { link: string; image: string } | null {
  const m = repository.match(/^https:\/\/(github\.com|gitlab\.com)\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#?].*)?$/)
  if (!m) return null
  const [, host, owner, repo] = m
  return host === 'github.com'
    ? { link: `https://github.com/${owner}/${repo}/blob/HEAD/`, image: `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/` }
    : { link: `https://gitlab.com/${owner}/${repo}/-/blob/HEAD/`, image: `https://gitlab.com/${owner}/${repo}/-/raw/HEAD/` }
}

/** An https URL for `raw` (http is upgraded, relative paths resolve against `base`), or null for anything else. */
export function safeUrl(raw: string | null, base: string | null): string | null {
  const v = (raw ?? '').trim()
  if (!v || v.startsWith('#')) return null
  let url: URL
  try {
    url = new URL(v.startsWith('//') ? 'https:' + v : v)
  } catch {
    if (!base) return null
    try {
      // `/docs/x.md` in a README means the repository root, not the host root.
      url = new URL(v.replace(/^\/+/, ''), base)
    } catch {
      return null
    }
  }
  if (url.protocol === 'http:') url.protocol = 'https:'
  return url.protocol === 'https:' && url.hostname ? url.href : null
}

/** GitHub-style heading anchor: `## Getting started!` -> `getting-started`. */
const slugOf = (text: string): string =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-')

function tidy(html: string, repository: string): string {
  // DOMParser documents are inert: nothing here loads images or runs anything.
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const base = repoBase(repository)

  for (const el of doc.body.querySelectorAll('[class]')) {
    const lang = el.tagName === 'CODE' && el.getAttribute('class')?.match(/(?:^|\s)language-([\w+#.-]+)/)
    if (lang) el.setAttribute('data-lang', lang[1])
    el.removeAttribute('class')
  }

  const slugs = new Map<string, number>()
  for (const h of doc.body.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    const slug = slugOf(h.textContent ?? '')
    const n = slugs.get(slug) ?? 0
    slugs.set(slug, n + 1)
    h.setAttribute('data-slug', n ? `${slug}-${n}` : slug)
  }

  for (const a of doc.body.querySelectorAll('a')) {
    const raw = a.getAttribute('href') ?? ''
    const href = raw.startsWith('#') && raw.length > 1 ? raw : safeUrl(raw, base?.link ?? null)
    if (href) a.setAttribute('href', href)
    else a.removeAttribute('href')
    if (href && !href.startsWith('#') && !a.title) a.title = href
  }

  // Remote images are blocked (CSP `img-src 'self' data:`), so every image shows as its alt text instead,
  // linked to the image when it has an https source and is not already inside a link.
  for (const img of doc.body.querySelectorAll('img')) {
    const alt = img.getAttribute('alt')?.trim()
    if (!alt) {
      img.remove()
      continue
    }
    const label = doc.createElement('span')
    label.className = 'md-img'
    label.textContent = alt
    const src = safeUrl(img.getAttribute('src'), base?.image ?? null)
    if (src && !img.closest('a')) {
      const a = doc.createElement('a')
      a.href = src
      a.title = src
      a.append(label)
      img.replaceWith(a)
    } else img.replaceWith(label)
  }

  // GFM task lists are the only inputs worth keeping, and they stay read-only.
  for (const input of doc.body.querySelectorAll('input')) {
    if (input.getAttribute('type') !== 'checkbox') input.remove()
    else input.setAttribute('disabled', '')
  }

  return doc.body.innerHTML
}

/** Renders an untrusted README to sanitized HTML. `repository` (an https URL) resolves relative links. */
export function renderMarkdown(source: string, repository = ''): string {
  purify ??= DOMPurify(window)
  const raw = marked.parse(source) as string
  const clean = purify.sanitize(raw, {
    ALLOWED_TAGS: TAGS,
    ALLOWED_ATTR: ATTRS,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(?:https?:|#|[^a-z]|[a-z0-9+.-]+(?:[^a-z0-9+.:-]|$))/i
  })
  return tidy(clean, repository)
}
