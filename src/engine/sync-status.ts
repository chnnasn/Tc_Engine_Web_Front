export interface CheckpointReceipt { runId: string; phase: 'start' | 'end'; revisionId: string; sceneVersion: string; persisted: true; current: boolean }

// The server's persisted flag describes its latest revision, not necessarily the current editor contents.
export function describeSync(local: { etag: string | null; matches: boolean; changedDuringQuery: boolean; blocked: boolean }, cloud: { etag: string | null; persisted: boolean }) {
  const conflict = local.etag !== cloud.etag
  const synced = !conflict && local.matches && !local.changedDuringQuery && cloud.etag !== null
  return {
    status: conflict ? 'conflict' : local.blocked ? 'blocked' : !synced ? 'local_changes' : cloud.persisted ? 'persisted' : 'synced_pending_persistence',
    currentContentSynced: synced,
    currentContentPersisted: synced && cloud.persisted,
    cloudEtag: cloud.etag,
    cloudPersisted: cloud.persisted,
    changedDuringQuery: local.changedDuringQuery,
  }
}
