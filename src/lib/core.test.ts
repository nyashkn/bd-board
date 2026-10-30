import { describe, expect, it, vi } from 'vitest'

import { bdCli, connectorFor } from '@/lib/core'
import * as server from '@/lib/server'

vi.mock('@/lib/server', () => ({
  addCommentFn: vi.fn(),
  createBeadFn: vi.fn(),
  deleteBeadFn: vi.fn(),
  enableEventsJournalFn: vi.fn(),
  getBeadDetailFn: vi.fn(),
  getBeads: vi.fn(),
  getCommentAuthorFn: vi.fn(),
  getProjectKnowledgeFn: vi.fn(),
  previewDeleteBeadFn: vi.fn(),
  readArtifactFn: vi.fn(),
  subscribeBeadFeed: vi.fn(),
  updateBeadFn: vi.fn(),
  updateBeadStatusFn: vi.fn(),
}))

describe('connectorFor', () => {
  it('returns bd-cli for every project', () => {
    expect(connectorFor('any')).toBe(bdCli)
  })

  it('maps each member to the server.ts export itself', () => {
    expect(bdCli.listBeads).toBe(server.getBeads)
    expect(bdCli.beadDetail).toBe(server.getBeadDetailFn)
    expect(bdCli.projectKnowledge).toBe(server.getProjectKnowledgeFn)
    expect(bdCli.readArtifact).toBe(server.readArtifactFn)
    expect(bdCli.subscribeFeed).toBe(server.subscribeBeadFeed)
    expect(bdCli.commentAuthor).toBe(server.getCommentAuthorFn)
    expect(bdCli.addComment).toBe(server.addCommentFn)
    expect(bdCli.updateStatus).toBe(server.updateBeadStatusFn)
    expect(bdCli.updateBead).toBe(server.updateBeadFn)
    expect(bdCli.createBead).toBe(server.createBeadFn)
    expect(bdCli.previewDelete).toBe(server.previewDeleteBeadFn)
    expect(bdCli.deleteBead).toBe(server.deleteBeadFn)
    expect(bdCli.enableEventsJournal).toBe(server.enableEventsJournalFn)
  })
})
