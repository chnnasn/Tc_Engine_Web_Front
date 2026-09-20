import { EngineError, type Snapshot, type Operation } from './protocol.ts'

export type EngineCall = <T = any>(type: string, payload?: unknown) => Promise<T>
export interface AutomationCommand { requestId: string; name: string; arguments: Record<string, any> }
export const supportedTools = ['editor_get_status', 'scene_get_tree', 'entity_get', 'component_get_schema',
  'entity_create', 'entity_delete', 'entity_reparent', 'component_add', 'component_remove', 'component_set',
  'editor_play', 'editor_pause', 'editor_stop', 'history_undo', 'history_redo'] as const
const version = (snapshot: Snapshot) => `${snapshot.sceneHandle}:${snapshot.revision}`

// Translate the shared desktop tool vocabulary at the engine boundary. Never expose arbitrary RPC.
export async function executeTool(command: AutomationCommand, call: EngineCall, changed: (state: Snapshot) => void) {
  try {
    const { name, arguments: args } = command
    if (!(supportedTools as readonly string[]).includes(name)) throw new EngineError('UNSUPPORTED_TOOL', name)
    let snapshot = await call<Snapshot>('snapshot')
    changed(snapshot)
    const meta = () => ({ scene_version: version(snapshot), scene_handle: snapshot.sceneHandle, mode: snapshot.mode || 'edit' })
    const success = (data: unknown) => ({ ok: true as const, data, request_id: command.requestId })
    if (name === 'editor_get_status') return success({ ...meta(), dirty: snapshot.dirty, canUndo: snapshot.canUndo, canRedo: snapshot.canRedo, tools: supportedTools })
    if (name === 'component_get_schema') return success({ ...meta(), schemas: snapshot.schemas })
    if (name === 'scene_get_tree') {
      const offset = args.offset ?? 0, limit = args.limit ?? 100
      if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 500) throw new EngineError('INVALID_ARGUMENT', 'Invalid pagination')
      return success({ ...meta(), total: snapshot.entities.length, entities: snapshot.entities.slice(offset, offset + limit).map(({ id, name, parentId, components }) => ({ id, name, parentId, componentIds: components.map(c => c.id) })) })
    }
    if (name === 'entity_get') {
      const entity = snapshot.entities.find(e => e.id === args.entity_id)
      if (!entity) throw new EngineError('ENTITY_NOT_FOUND', 'Entity does not exist')
      return success({ ...meta(), entity })
    }
    if (args.scene_version !== undefined && args.scene_version !== version(snapshot)) throw new EngineError('SCENE_CHANGED', 'Scene changed. Read it again before editing.')
    if (['editor_play', 'editor_pause', 'editor_stop'].includes(name)) {
      await call('preview', { command: name.slice('editor_'.length) })
      snapshot = await call<Snapshot>('snapshot'); changed(snapshot)
      return success(meta())
    }
    if (snapshot.mode && snapshot.mode !== 'edit') throw new EngineError('EDIT_MODE_REQUIRED', 'Stop Play before authoring edits.')
    if (name === 'history_undo' || name === 'history_redo') {
      snapshot = await call<Snapshot>('history', { state: snapshot, direction: name === 'history_undo' ? 'undo' : 'redo' })
      changed(snapshot); return success(meta())
    }
    let operations: Operation[]
    let createdId: string | undefined
    switch (name) {
      case 'entity_create': {
        if (typeof args.name !== 'string' || !args.name.trim() || args.name.length > 256) throw new EngineError('INVALID_ARGUMENT', 'Invalid entity name')
        do {
          const bits = crypto.getRandomValues(new Uint32Array(2))
          createdId = ((BigInt(bits[0]!) << 32n) | BigInt(bits[1]!)).toString()
        } while (createdId === '0' || snapshot.entities.some(e => e.id === createdId))
        operations = [{ op: 'entity.create', entityId: createdId, name: args.name }]; break
      }
      case 'entity_delete': operations = [{ op: 'entity.delete', entityId: args.entity_id }]; break
      case 'entity_reparent': operations = [{ op: 'entity.set-parent', entityId: args.entity_id, parentId: args.parent_id }]; break
      case 'component_add': case 'component_remove':
        operations = [{ op: name === 'component_add' ? 'component.add' : 'component.remove', entityId: args.entity_id, componentId: args.component_id }]; break
      case 'component_set':
        operations = [{ op: 'component.patch', entityId: args.entity_id, componentId: args.component_id, properties: { [args.property_id]: args.value } }]; break
      default: throw new EngineError('UNSUPPORTED_TOOL', name)
    }
    snapshot = await call<Snapshot>('transact', { state: snapshot, label: `AI: ${name}`, operations })
    changed(snapshot)
    return success({ ...meta(), ...(createdId ? { entity: snapshot.entities.find(e => e.id === createdId) } : {}) })
  } catch (error) {
    const code = error instanceof EngineError ? (error.code === 'REVISION_CONFLICT' ? 'SCENE_CHANGED' : error.code) : 'ENGINE_ERROR'
    return { ok: false as const, request_id: command.requestId, error: { code, message: error instanceof Error ? error.message : String(error) } }
  }
}
