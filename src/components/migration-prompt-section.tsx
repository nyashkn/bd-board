import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Copy } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useBdStatus } from '@/hooks/use-bd-status'
import { useCopy } from '@/hooks/use-copy'
import { buildMigrationPrompt, MIGRATION_OPTIONS } from '@/lib/migration-prompt'
import type { MigrationOption } from '@/lib/migration-prompt'
import { probeDoltModeFn } from '@/lib/server'
import type { Project } from '@/lib/types'

/**
 * Copy a migration prompt for an AI agent. Shown only when `bd dolt show --json` says the project
 * is embedded; bd-board never migrates anything itself. Copying changes nothing, so read-only
 * projects get it too.
 */
export function MigrationPromptSection({ project }: { project: Project }) {
  const [option, setOption] = useState<MigrationOption>('shared-server')
  const [copyState, copy] = useCopy()
  const bd = useBdStatus()
  const probe = useQuery({
    queryKey: ['dolt-probe', project.id],
    queryFn: () => probeDoltModeFn({ data: { project: project.id } }),
    staleTime: 60_000,
    retry: false,
  })
  const reply = probe.data
  // An error (including explicit `sources`, which are not probed) means mode unknown: no entry point.
  if (!reply || 'error' in reply || reply.embedded !== true) return null

  const prompt = () =>
    buildMigrationPrompt(
      {
        path: project.dir,
        prefix: project.prefix,
        mode: 'embedded',
        bdVersion: bd.data?.state === 'ok' ? bd.data.version : null,
      },
      option,
    )

  return (
    <div className="space-y-2 rounded-lg bg-muted p-3 text-sm">
      <Label htmlFor="migration-option">Faster setup</Label>
      <p className="text-xs text-muted-foreground">
        This project uses embedded Dolt. Copy instructions for an AI agent to
        move it; bd-board changes nothing.
      </p>
      <div className="flex gap-2">
        <Select
          value={option}
          onValueChange={(v) => setOption(v as MigrationOption)}
        >
          <SelectTrigger id="migration-option" className="min-w-0 flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MIGRATION_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          onClick={() => copy(prompt())}
          data-testid="copy-migration-prompt"
        >
          {copyState === 'copied' ? (
            <Check className="size-4" aria-hidden="true" />
          ) : (
            <Copy className="size-4" aria-hidden="true" />
          )}
          Copy prompt
        </Button>
      </div>
      <span role="status" aria-live="polite" className="sr-only">
        {copyState === 'copied'
          ? 'Copied'
          : copyState === 'failed'
            ? 'Copy failed'
            : ''}
      </span>
      {copyState !== 'idle' && (
        <p className="text-xs text-muted-foreground" aria-hidden="true">
          {copyState === 'copied' ? 'Copied' : 'Copy failed'}
        </p>
      )}
    </div>
  )
}
