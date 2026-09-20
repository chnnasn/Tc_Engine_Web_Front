import lock from '../../engine.lock.json' with { type: 'json' }
import { assertHandle } from './protocol.ts'

export interface EngineDocument {
  format: 'tomcat-engine-project'
  version: 1 | 2
  engineCommit: string
  sceneHandle: string
  archive: string
  files: Record<string, string> // Base64 MEMFS project settings and imported assets (including .tcmeta).
}
export const engineCommit = lock.commit
export const projectRoot = '/Samples/PhysicsPlayground'
export interface CloudBinding { ownerId: string; projectId: string; etag: string | null; pending?: boolean }
export const requiredFiles = ['Project.tcproj', 'ProjectSettings/BuildSettings.json', 'ProjectSettings/ProjectSettings.json', 'ProjectSettings/PlayerSettings.json']
export function validFilePath(path: string) {
  return path === 'Project.tcproj' || /^ProjectSettings\/[A-Za-z0-9_-]+\.json$/.test(path) ||
    (path.length <= 240 && path.startsWith('Assets/') && path.split('/').every(part => /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(part) && !part.endsWith('.')))
}
export function assertDocument(value: unknown): asserts value is EngineDocument {
  const d = value as EngineDocument
  if (!d || d.format !== 'tomcat-engine-project' || ![1, 2].includes(d.version) || d.engineCommit !== engineCommit || typeof d.archive !== 'string' || new TextEncoder().encode(d.archive).length > 4 * 1024 * 1024 || !d.files || typeof d.files !== 'object' || Array.isArray(d.files)) throw new Error('项目格式或引擎版本不兼容')
  assertHandle(d.sceneHandle)
  let bytes = 0
  const paths = Object.keys(d.files)
  if (paths.length > 512 || new Set(paths.map(path => path.toLowerCase())).size !== paths.length) throw new Error('项目文件过多或路径重复')
  for (const [path, data] of Object.entries(d.files)) {
    if (!validFilePath(path) || typeof data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) throw new Error('无效的项目文件')
    bytes += data.length
    if (data.length > Math.ceil(8 * 1024 * 1024 / 3) * 4) throw new Error('单个文件不能超过 8 MiB')
  }
  if (bytes > 48 * 1024 * 1024) throw new Error('项目资源超过本地归档限制')
  if (d.version === 2) {
    if (requiredFiles.some(path => !Object.prototype.hasOwnProperty.call(d.files, path))) throw new Error('项目配置不完整')
    for (const path of paths) {
      if (/\.(png|jpe?g|tga)$/i.test(path) && !Object.prototype.hasOwnProperty.call(d.files, `${path}.tcmeta`)) throw new Error('图片缺少 .tcmeta')
      if (path.endsWith('.tcmeta') && !Object.prototype.hasOwnProperty.call(d.files, path.slice(0, -7))) throw new Error('.tcmeta 缺少源文件')
    }
  }
}
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let blocked = false
    const request = indexedDB.open('tomcat-engine-v1', 2)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('projects')) request.result.createObjectStore('projects')
      if (!request.result.objectStoreNames.contains('cloudLinks')) request.result.createObjectStore('cloudLinks')
    }
    request.onblocked = () => { blocked = true; reject(new Error('请关闭其他旧版编辑器页面后重试')) }
    request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result) }
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
export async function readCloudBinding(id: string): Promise<CloudBinding | undefined> {
  const db = await database()
  try {
    return await new Promise((resolve, reject) => {
      const r = db.transaction('cloudLinks').objectStore('cloudLinks').get(id)
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error)
    })
  } finally { db.close() }
}
export async function writeCloudBinding(id: string, binding: CloudBinding | null) {
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('cloudLinks', 'readwrite')
      if (binding) tx.objectStore('cloudLinks').put(binding, id); else tx.objectStore('cloudLinks').delete(id)
      tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error)
    })
  } finally { db.close() }
}
export async function writeEngineProject(id: string, value?: EngineDocument, binding?: CloudBinding | null) {
  if (value) assertDocument(value)
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['projects', 'cloudLinks'], 'readwrite')
      if (value) tx.objectStore('projects').put(value, id)
      else tx.objectStore('projects').delete(id)
      if (!value || binding === null) tx.objectStore('cloudLinks').delete(id)
      else if (binding) tx.objectStore('cloudLinks').put(binding, id)
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('保存被取消'))
    })
  } finally { db.close() }
}
