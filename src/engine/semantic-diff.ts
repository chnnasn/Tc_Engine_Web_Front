import type { Snapshot } from './protocol.ts'
import type { EngineDocument } from './storage.ts'

export interface SemanticChange { entityId?: string; entity?: string; component?: string; property: string; before: unknown; after: unknown }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
/** Compare stable IDs, never array order or display labels. Missing values are explicit nulls. */
export function sceneDiff(before: Snapshot, after: Snapshot, limit = 500) {
  const changes: SemanticChange[] = []
  let total = 0
  const add = (change: SemanticChange) => { total++; if (changes.length < limit) changes.push(change) }
  if (before.sceneHandle !== after.sceneHandle) throw new Error('Cannot compare different scenes')
  const previous = new Map(before.entities.map(e => [e.id, e]))
  const current = new Map(after.entities.map(e => [e.id, e]))
  if (before.name !== after.name) add({ property: '场景名称', before: before.name, after: after.name })
  for (const id of new Set([...previous.keys(), ...current.keys()])) {
    const a = previous.get(id), b = current.get(id), base = { entityId: id, entity: b?.name ?? a?.name }
    if (!a || !b) { add({ ...base, property: '实体', before: a ?? null, after: b ?? null }); continue }
    for (const key of ['name', 'parentId'] as const) if (a[key] !== b[key]) add({ ...base, property: key, before: a[key], after: b[key] })
    const ac = new Map(a.components.map(c => [c.id, c])), bc = new Map(b.components.map(c => [c.id, c]))
    for (const cid of new Set([...ac.keys(), ...bc.keys()])) {
      const left = ac.get(cid), right = bc.get(cid)
      const schema = after.schemas.find(s => s.id === cid) ?? before.schemas.find(s => s.id === cid)
      const component = schema?.label || schema?.name || cid
      if (!left || !right) { add({ ...base, component, property: '组件', before: left ?? null, after: right ?? null }); continue }
      for (const pid of new Set([...Object.keys(left.values), ...Object.keys(right.values)])) {
        if (!same(left.values[pid], right.values[pid])) add({ ...base, component, property: schema?.properties.find(p => p.id === pid)?.label || pid, before: left.values[pid] ?? null, after: right.values[pid] ?? null })
      }
    }
  }
  return { base_version: `${before.sceneHandle}:${before.revision}`, scene_version: `${after.sceneHandle}:${after.revision}`, total, truncated: total > changes.length, changes,
    archiveChanged: before.archive !== after.archive, coverage: 'Inspector-visible entity/component properties; opaque archive and file changes are reported separately.' }
}

export function fileDiff(before: EngineDocument, after: EngineDocument) {
  return [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])].sort().filter(path => before.files[path] !== after.files[path])
    .map(path => ({ path, change: !(path in before.files) ? 'added' : !(path in after.files) ? 'removed' : 'modified' }))
}
