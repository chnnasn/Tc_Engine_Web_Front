import lock from '../../engine.lock.json' with { type: 'json' }
import { assertHandle } from './protocol.ts'

export interface EngineDocument {
  format: 'tomcat-engine-project'
  version: 1
  engineCommit: string
  sceneHandle: string
  archive: string
  files: Record<string, string> // Base64 MEMFS project settings and imported assets (including .tcmeta).
}
export const engineCommit = lock.commit
export const projectRoot = '/Samples/PhysicsPlayground'
export function validFilePath(path: string) {
  return /^ProjectSettings\/[A-Za-z0-9_-]+\.json$/.test(path) || /^Assets\/WebImports\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(path)
}
export function assertDocument(value: unknown): asserts value is EngineDocument {
  const d = value as EngineDocument
  if (!d || d.format !== 'tomcat-engine-project' || d.version !== 1 || d.engineCommit !== engineCommit || typeof d.archive !== 'string' || new TextEncoder().encode(d.archive).length > 4 * 1024 * 1024 || !d.files || typeof d.files !== 'object' || Array.isArray(d.files)) throw new Error('项目格式或引擎版本不兼容')
  assertHandle(d.sceneHandle)
  let bytes = 0
  for (const [path, data] of Object.entries(d.files)) {
    if (!validFilePath(path) || typeof data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) throw new Error('无效的项目文件')
    bytes += data.length
  }
  if (bytes > 48 * 1024 * 1024) throw new Error('项目资源超过本地归档限制')
}
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('tomcat-engine-v1', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('projects')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
export async function readEngineProject(id: string): Promise<EngineDocument | undefined> {
  const db = await database()
  try {
    const value = await new Promise<unknown>((resolve, reject) => {
      const r = db.transaction('projects').objectStore('projects').get(id)
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error)
    })
    if (value !== undefined) assertDocument(value)
    return value as EngineDocument | undefined
  } finally { db.close() }
}
export async function writeEngineProject(id: string, value?: EngineDocument) {
  if (value) assertDocument(value)
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('projects', 'readwrite')
      if (value) tx.objectStore('projects').put(value, id)
      else tx.objectStore('projects').delete(id)
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('保存被取消'))
    })
  } finally { db.close() }
}
