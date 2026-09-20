export const PROTOCOL = 'tomcat.web.v1'
export type Handle = string
export type PropertyValue = string | number | boolean | number[]
export interface PropertySchema { id: Handle; name: string; label: string; kind: number; writable: boolean; assetTypes: string[]; entityReference: boolean }
export interface ComponentSchema { id: Handle; name: string; label: string; addable: boolean; removable: boolean; properties: PropertySchema[] }
export interface SceneState { sceneHandle: Handle; revision: number; selectedEntityId: Handle | null; dirty: boolean; canUndo: boolean; canRedo: boolean; mode?: 'edit' | 'play' | 'pause' }
export interface Snapshot extends SceneState { name: string; archive: string; entities: { id: Handle; name: string; parentId: Handle | null; components: { id: Handle; values: Record<Handle, PropertyValue> }[] }[]; schemas: ComponentSchema[] }
export type Operation =
  | { op: 'entity.create'; entityId: Handle; name: string; parentId?: Handle | null }
  | { op: 'entity.delete'; entityId: Handle }
  | { op: 'entity.rename'; entityId: Handle; name: string }
  | { op: 'entity.set-parent'; entityId: Handle; parentId: Handle | null }
  | { op: 'component.add' | 'component.remove'; entityId: Handle; componentId: Handle }
  | { op: 'component.patch'; entityId: Handle; componentId: Handle; properties: Record<Handle, PropertyValue> }
export class EngineError extends Error {
  code: string
  constructor(code: string, message: string) { super(message); this.code = code }
}
export function assertHandle(value: unknown): asserts value is Handle {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value) || BigInt(value) > 18446744073709551615n) throw new Error('Invalid uint64 string')
}
export function assertState(value: SceneState) {
  assertHandle(value.sceneHandle)
  if (value.selectedEntityId !== null) assertHandle(value.selectedEntityId)
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error('Invalid scene revision')
}
export class EditorProtocol {
  private sequence = 0
  private invoke: (json: string) => string
  constructor(invoke: (json: string) => string) { this.invoke = invoke }
  request<T>(type: string, payload: Record<string, unknown> = {}): T {
    const requestId = String(++this.sequence)
    const reply = JSON.parse(this.invoke(JSON.stringify({ protocol: PROTOCOL, requestId, type, payload })))
    if (reply.protocol !== PROTOCOL || reply.requestId !== requestId) throw new Error('Engine protocol mismatch')
    if (reply.ok !== true) throw new EngineError(reply.error?.code || 'RPC_ERROR', reply.error?.message || 'Engine request failed')
    if (reply.result?.sceneHandle !== undefined) assertState(reply.result)
    return reply.result as T
  }
  snapshot(sceneHandle: Handle) { return this.request<Snapshot>('scene.snapshot', { sceneHandle }) }
  transact(state: SceneState, label: string, operations: Operation[]) {
    assertState(state)
    for (const operation of operations) {
      assertHandle(operation.entityId)
      if ('componentId' in operation) assertHandle(operation.componentId)
      if ('parentId' in operation && operation.parentId != null) assertHandle(operation.parentId)
    }
    return this.request<Snapshot>('scene.transact', { sceneHandle: state.sceneHandle, baseRevision: state.revision, label, operations })
  }
  history(state: SceneState, direction: 'undo' | 'redo') {
    return this.request<Snapshot>(`history.${direction}`, { sceneHandle: state.sceneHandle, baseRevision: state.revision })
  }
}
