import { assertDocument, engineCommit, validFilePath, requiredFiles, type CloudBinding, type EngineDocument } from './storage.ts'

export interface CloudUser { id: string; username: string }
export interface CloudProject { id: string; name: string; description: string; template: '2D' | '空白'; currentRevisionId: string | null; etag: string | null }
export interface AiCheckpoint { runId: string; phase: 'start' | 'end'; sceneVersion: string }
export interface CloudRevision { revisionId: string; etag: string; createdAt: string; aiCheckpoint?: AiCheckpoint }
interface FileReference { path: string; uploadId: string; contentHash: string; size: number }
interface Manifest { schemaVersion: 2; engineCommit: string; sceneHandle: string; archive: string; files: FileReference[]; aiCheckpoint?: AiCheckpoint }
export interface RestoredProject { project: CloudProject; document: EngineDocument; binding?: CloudBinding }
export class CloudError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}
async function api(path: string, init: RequestInit = {}) {
  let response: Response
  try {
    response = await fetch(`/v1${path}`, { ...init, credentials: 'same-origin', signal: AbortSignal.timeout(60000), headers: { 'X-TomCat-Request': '1', ...init.headers } })
  } catch { throw new CloudError(0, '无法连接云端，本地内容已保留，请检查网络后重试') }
  if (!response.ok) {
    let message = '云端请求失败'
    try { message = (await response.json()).error || message } catch { /* Empty precondition responses. */ }
    if (response.status === 401) message = '请先登录云端账号'
    if (response.status === 404) message = '云端项目或文件不存在，或当前账号没有访问权限'
    if (response.status === 412) message = '云端已有新修订，本地内容已保留。请从项目列表恢复最新版本进行比较，或另建云端项目'
    throw new CloudError(response.status, message)
  }
  if (response.status !== 204 && !path.includes('/uploads/') && !response.headers.get('content-type')?.includes('application/json')) throw new CloudError(0, '云端接口未配置，请连接后端 /v1 服务')
  return response
}
const json = (method: string, body: unknown, headers = {}) => ({ method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
const idPath = (id: string) => `/projects/${encodeURIComponent(id)}`
export const currentUser = async (): Promise<CloudUser> => (await api('/auth/me')).json()
export const authenticate = async (mode: 'login' | 'register', username: string, password: string): Promise<CloudUser> => (await api(`/auth/${mode}`, json('POST', { username, password }))).json()
export const logout = async () => { await api('/auth/logout', { method: 'POST' }) }
export const listCloudProjects = async (): Promise<CloudProject[]> => (await api('/projects')).json()
export const createCloudProject = async (project: { name: string; description: string; template: string }): Promise<CloudProject> => (await api('/projects', json('POST', project))).json()
export const listRevisions = async (id: string): Promise<CloudRevision[]> => (await api(`${idPath(id)}/revisions`)).json()
export function decodeFile(base64: string): Uint8Array { return Uint8Array.from(atob(base64), char => char.charCodeAt(0)) }
function encodeFile(bytes: Uint8Array) {
  let result = ''
  for (let i = 0; i < bytes.length; i += 8192) result += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(result)
}
export async function contentHash(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
export const syncConfiguration = async (): Promise<{ enabled: boolean; intervalMs: number }> => (await api('/projects/sync-config')).json()
export const cloudSyncStatus = async (id: string): Promise<{ etag: string | null; persisted: boolean }> => (await api(`${idPath(id)}/sync-status`)).json()
export async function saveCloudProject(document: EngineDocument, binding: CloudBinding, options: { automatic?: boolean; reuseUploads?: boolean; checkpoint?: AiCheckpoint } = {}): Promise<CloudBinding> {
  if (options.automatic && options.checkpoint) throw new Error('检查点必须立即落库')
  assertDocument(document)
  if (document.version !== 2) throw new Error('请在引擎中打开旧项目并保存完整配置后，再同步云端')
  const user = await currentUser()
  if (user.id !== binding.ownerId) throw new Error('此项目关联其他云端账号，请切换账号或解除关联')
  const files: FileReference[] = []
  for (const [path, encoded] of Object.entries(document.files)) {
    const bytes = decodeFile(encoded)
    const hash = await contentHash(bytes)
    let uploaded: { uploadId: string; contentHash: string; size: number } | undefined
    if (options.reuseUploads) {
      try { uploaded = await (await api(`${idPath(binding.projectId)}/uploads/by-hash/${hash}`)).json() }
      catch (error) { if (!(error instanceof CloudError && error.status === 404)) throw error }
    }
    if (!uploaded) uploaded = await (await api(`${idPath(binding.projectId)}/uploads/${hash}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(bytes).buffer })).json()
    if (!uploaded || uploaded.contentHash !== hash || uploaded.size !== bytes.length || !/^[a-f0-9]{32}$/.test(uploaded.uploadId)) throw new Error('云端上传校验失败')
    files.push({ path, uploadId: uploaded.uploadId, contentHash: hash, size: bytes.length })
  }
  const manifest: Manifest = { schemaVersion: 2, engineCommit: document.engineCommit, sceneHandle: document.sceneHandle, archive: document.archive, files }
  if (options.checkpoint) manifest.aiCheckpoint = options.checkpoint
  const headers = binding.etag === null ? { 'If-None-Match': '*' } : { 'If-Match': binding.etag }
  const response = await api(`${idPath(binding.projectId)}/${options.automatic ? 'working-state' : 'revisions'}`, json(options.automatic ? 'PUT' : 'POST', manifest, headers))
  const saved = await response.json()
  if (!/^"[a-f0-9]{32}"$/.test(saved.etag) || response.headers.get('etag') !== saved.etag) throw new Error('云端返回的修订凭据无效，请恢复最新修订后继续')
  return { ...binding, etag: saved.etag, pending: false }
}
export async function restoreCloudProject(projectId: string, revisionId?: string): Promise<RestoredProject> {
  const user = await currentUser()
  const project: CloudProject = await (await api(idPath(projectId))).json()
  const revision = revisionId || project.currentRevisionId
  if (!revision) throw new Error('此云端项目尚无已保存修订')
  const response = await api(revisionId ? `${idPath(projectId)}/revisions/${encodeURIComponent(revisionId)}` : `${idPath(projectId)}/working-state`)
  const manifest: Manifest = await response.json()
  if (manifest.schemaVersion !== 2 || manifest.engineCommit !== engineCommit || !Array.isArray(manifest.files) || manifest.files.length > 512) throw new Error('此修订不包含完整资源，或使用了不兼容的引擎版本')
  const paths = new Set<string>()
  let total = 0
  for (const file of manifest.files) {
    if (!file || typeof file.path !== 'string' || !validFilePath(file.path) || paths.has(file.path.toLowerCase()) ||
        !/^[a-f0-9]{32}$/.test(file.uploadId) || !/^[a-f0-9]{64}$/.test(file.contentHash) || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > 8 * 1024 * 1024) throw new Error('云端文件清单无效')
    paths.add(file.path.toLowerCase()); total += file.size
  }
  if (total > 36 * 1024 * 1024 || requiredFiles.some(path => !manifest.files.some(file => file.path === path))) throw new Error('云端项目超出限制或配置不完整')
  const files: Record<string, string> = {}
  for (const file of manifest.files) {
    const downloaded = await api(`${idPath(projectId)}/uploads/${file.uploadId}`)
    const bytes = new Uint8Array(await downloaded.arrayBuffer())
    if (bytes.length !== file.size || await contentHash(bytes) !== file.contentHash) throw new Error(`文件完整性校验失败：${file.path}`)
    files[file.path] = encodeFile(bytes)
  }
  const document: EngineDocument = { format: 'tomcat-engine-project', version: 2, engineCommit: manifest.engineCommit, sceneHandle: manifest.sceneHandle, archive: manifest.archive, files }
  assertDocument(document)
  const etag = response.headers.get('etag')
  if (!etag || !/^"[a-f0-9]{32}"$/.test(etag) || (revisionId && etag !== `"${revisionId}"`)) throw new Error('云端修订凭据不一致')
  return { project, document, binding: !revisionId || revision === project.currentRevisionId ? { ownerId: user.id, projectId, etag, pending: false } : undefined }
}
