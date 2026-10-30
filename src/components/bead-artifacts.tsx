import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, FileText, Paperclip } from 'lucide-react'
import Markdown from 'react-markdown'

import { Skeleton } from '@/components/ui/skeleton'
import { InteractiveRow } from '@/components/ui/interactive-row'
import {
  artifactGroups,
  classifyArtifactPath,
  parseExternalRef,
} from '@/lib/artifacts'
import { connectorFor } from '@/lib/core'
import { PROSE_CLASS, cn, toErrorMessage } from '@/lib/utils'

import type { Artifact, ArtifactFile } from '@/lib/artifacts'
import type { ReactNode } from 'react'
import type { Bead } from '@/lib/types'

/** Renders one already-read artifact. HTML is sandboxed without same-origin. */
export function ArtifactViewer({ file }: { file: ArtifactFile }) {
  switch (file.kind) {
    case 'markdown':
      return (
        <div className={PROSE_CLASS}>
          <Markdown>{file.content}</Markdown>
        </div>
      )
    case 'html':
      return (
        <iframe
          title="HTML artifact"
          sandbox="allow-scripts"
          srcDoc={file.content}
          className="h-[420px] w-full rounded-[7px] bg-white ring-1 ring-inset ring-border"
        />
      )
    case 'image':
      return (
        <img
          src={file.content}
          alt="Artifact"
          className="max-h-[420px] max-w-full rounded-[7px] ring-1 ring-border"
        />
      )
    default:
      return (
        <pre className="max-h-[420px] overflow-auto rounded-[7px] bg-muted p-3 text-xs">
          {file.content}
        </pre>
      )
  }
}

function ArtifactPane({
  project,
  artifact,
}: {
  project: string
  artifact: Artifact
}) {
  const query = useQuery({
    queryKey: ['artifact', project, artifact.path],
    queryFn: () =>
      connectorFor(project).readArtifact({
        data: { project, path: artifact.path },
      }),
    retry: false,
    staleTime: 3000,
  })
  return (
    <div className="mt-2 rounded-[9px] bg-canvas p-3 ring-1 ring-inset ring-border">
      {query.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : query.error ? (
        <p role="alert" className="text-xs text-destructive">
          {toErrorMessage(query.error, 'Could not read this file')}
        </p>
      ) : query.data ? (
        <ArtifactViewer file={query.data} />
      ) : null}
    </div>
  )
}

function ExternalRefRow({ value }: { value: string | undefined }) {
  const ref = parseExternalRef(value)
  if (!ref) return null
  return (
    <div className="flex items-center gap-2 text-[12.5px]">
      <span className="rounded-[4px] bg-muted px-1.5 py-0.5 font-mono text-[10px] tracking-[0.08em] uppercase text-muted-foreground">
        Ref
      </span>
      {ref.kind === 'link' ? (
        <a
          href={ref.href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-w-0 items-center gap-1 truncate text-foreground underline underline-offset-2"
        >
          <span className="truncate">{ref.href}</span>
          <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
        </a>
      ) : (
        <span className="truncate font-mono">{ref.text}</span>
      )}
    </div>
  )
}

export function BeadArtifacts({
  project,
  bead,
  header,
}: {
  project: string
  bead: Bead
  header: (count: number) => ReactNode
}) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const groups = artifactGroups(bead)
  const count = groups.reduce((n, g) => n + g.artifacts.length, 0)
  if (count === 0 && !parseExternalRef(bead.external_ref)) return null

  return (
    <section>
      {header(count)}
      <div className="flex flex-col gap-3">
        <ExternalRefRow value={bead.external_ref} />
        {groups.map((group) => (
          <div
            key={group.child?.id ?? 'self'}
            className="flex flex-col gap-1.5"
          >
            {group.child ? (
              <p className="flex items-center gap-1.5 font-mono text-[10.5px] text-faint">
                <Paperclip className="size-3" aria-hidden="true" />
                {group.child.id} · {group.child.title}
              </p>
            ) : null}
            {group.artifacts.map((artifact, i) => {
              const key = `${group.child?.id ?? 'self'}:${i}:${artifact.path}`
              const target = classifyArtifactPath(artifact.path)
              const open = openKey === key
              const chip = (text: string) => (
                <span className="rounded-[4px] bg-muted px-1.5 py-0.5 font-mono text-[10px] tracking-[0.08em] uppercase text-muted-foreground">
                  {text}
                </span>
              )
              const inner = (
                <>
                  {target.kind === 'remote' ? (
                    <ExternalLink
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  ) : (
                    <FileText
                      className={cn(
                        'size-3.5 shrink-0',
                        open ? 'text-foreground' : 'text-muted-foreground',
                      )}
                      aria-hidden="true"
                    />
                  )}
                  {artifact.stage ? chip(artifact.stage) : null}
                  {target.kind === 'remote' ? chip('remote') : null}
                  {target.kind === 'invalid' ? chip('invalid') : null}
                  <span className="min-w-0 truncate text-[12.75px]">
                    {artifact.label}
                  </span>
                  <span className="ml-auto truncate font-mono text-[10.5px] text-faint">
                    {artifact.path}
                  </span>
                </>
              )
              if (target.kind === 'remote') {
                return (
                  <a
                    key={key}
                    href={target.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2.5 rounded-[8px] bg-card px-[10px] py-2 ring-1 ring-inset ring-border hover:bg-card-hover"
                  >
                    {inner}
                  </a>
                )
              }
              if (target.kind === 'invalid') {
                return (
                  <div
                    key={key}
                    className="flex items-center gap-2.5 rounded-[8px] bg-card px-[10px] py-2 opacity-70 ring-1 ring-inset ring-border"
                  >
                    {inner}
                  </div>
                )
              }
              return (
                <div key={key}>
                  <InteractiveRow
                    size="compact"
                    aria-expanded={open}
                    onClick={() => setOpenKey(open ? null : key)}
                  >
                    {inner}
                  </InteractiveRow>
                  {open ? (
                    <ArtifactPane project={project} artifact={artifact} />
                  ) : null}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </section>
  )
}
