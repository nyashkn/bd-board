import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ArtifactViewer, BeadArtifacts } from './bead-artifacts'

import type { Bead } from '@/lib/types'

const view = (kind: string, content: string) =>
  renderToStaticMarkup(
    createElement(ArtifactViewer, {
      file: { kind, content, bytes: 1, mtime: 0 } as never,
    }),
  )

describe('ArtifactViewer', () => {
  it('renders markdown', () => {
    expect(view('markdown', '# Title')).toContain('<h1>Title</h1>')
  })
  it('sandboxes html with scripts only', () => {
    const html = view('html', '<p>x</p>')
    expect(html).toContain('sandbox="allow-scripts"')
    expect(html).not.toContain('allow-same-origin')
    expect(html).toContain('srcDoc')
  })
  it('renders images and text', () => {
    expect(view('image', 'data:image/png;base64,AQID')).toContain('<img')
    expect(view('json', '{"a":1}')).toContain('<pre')
  })
})

describe('BeadArtifacts', () => {
  const render = (bead: Partial<Bead>) =>
    renderToStaticMarkup(
      createElement(BeadArtifacts, {
        project: 'p',
        bead: { id: 'b', title: 't', ...bead } as Bead,
        header: (n) => createElement('h3', null, `Artifacts ${n}`),
      }),
    )

  it('lists spec, stage chip, label, path; survives bad metadata', () => {
    const out = render({
      spec_id: 'docs/s.md',
      metadata: {
        artifacts: '[{"path":"r.html","label":"Report","stage":"qa"}]',
      },
    })
    expect(out).toContain('Spec')
    expect(out).toContain('Report')
    expect(out).toContain('qa')
    expect(out).toContain('r.html')
    expect(render({ metadata: { artifacts: '{bad' } })).toBe('')
  })

  it('renders an http external_ref as a safe anchor and others as text', () => {
    const link = render({ external_ref: 'https://x.test/i/1' })
    expect(link).toContain('href="https://x.test/i/1"')
    expect(link).toContain('target="_blank"')
    expect(link).toContain('rel="noopener noreferrer"')
    const text = render({ external_ref: 'gh-9' })
    expect(text).toContain('Ref')
    expect(text).toContain('gh-9')
    expect(text).not.toContain('<a ')
  })
})
