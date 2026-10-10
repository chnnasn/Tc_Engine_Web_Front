import { assertHandle, EngineError, type Operation } from './protocol.ts'

export function validatePatch(value: unknown): Operation[] {
  const fail = () => { throw new EngineError('INVALID_ARGUMENT', 'Expected 1–128 valid scene operations with uint64 string IDs.') }
  if (!Array.isArray(value) || value.length < 1 || value.length > 128) return fail()
  const fields: Record<string, string[]> = {
    'entity.create': ['entityId', 'name', 'parentId'], 'entity.delete': ['entityId'], 'entity.rename': ['entityId', 'name'],
    'entity.set-parent': ['entityId', 'parentId'], 'component.add': ['entityId', 'componentId'],
    'component.remove': ['entityId', 'componentId'], 'component.patch': ['entityId', 'componentId', 'properties'],
  }
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || !Object.prototype.hasOwnProperty.call(fields, item.op) || Object.keys(item).some(k => k !== 'op' && !fields[item.op]!.includes(k))) return fail()
    try { assertHandle(item.entityId); if (item.entityId === '0') return fail(); if (item.op.startsWith('component.')) assertHandle(item.componentId); if (item.parentId != null) assertHandle(item.parentId) } catch { return fail() }
    if (['entity.create', 'entity.rename'].includes(item.op) && (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 256)) return fail()
    if (item.op === 'entity.set-parent' && !Object.prototype.hasOwnProperty.call(item, 'parentId')) return fail()
    if (item.op === 'component.patch') {
      if (!item.properties || typeof item.properties !== 'object' || Array.isArray(item.properties) || !Object.keys(item.properties).length) return fail()
      for (const [id, v] of Object.entries(item.properties)) {
        try { assertHandle(id) } catch { return fail() }
        if (!(typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (Array.isArray(v) && v.length >= 2 && v.length <= 4 && v.every(n => typeof n === 'number' && Number.isFinite(n))))) return fail()
      }
    }
  }
  return value as Operation[]
}
