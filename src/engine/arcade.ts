// 玩家作品（已发布游戏）的公开接口。游客可访问，不经过登录态检查；
// 打包下载与播放器预览保持一致的 256 MiB 上限。
import { engineCommit, legacyEngineCommits } from './storage.ts'

export const MAX_PACKAGE = 256 * 1024 * 1024

export interface PublishedGame {
  id: string
  title: string
  description: string
  byteLength: number
  etag: string
  publishedAt: string
  engineCommit: string
}

export class ArcadeError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

async function request(path: string, init: RequestInit = {}, timeoutMs = 20000): Promise<Response> {
  let response: Response
  try { response = await fetch(`/v1${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) }) }
  catch { throw new ArcadeError(0, '无法连接服务器，请稍后重试') }
  if (!response.ok) {
    let message = '请求失败，请稍后重试'
    try { message = (await response.json()).error || message } catch { /* Empty error bodies. */ }
    throw new ArcadeError(response.status, message)
  }
  return response
}

export const listPublishedGames = async (): Promise<PublishedGame[]> => (await request('/games/published')).json()
export const publishedGame = async (id: string): Promise<PublishedGame> => (await request(`/games/published/${encodeURIComponent(id)}`)).json()

export async function loadPublishedPackage(id: string, signal?: AbortSignal): Promise<Uint8Array> {
  let response: Response
  try { response = await fetch(`/v1/games/published/${encodeURIComponent(id)}/package`, { signal }) }
  catch { throw new ArcadeError(0, '无法连接服务器，游戏包未能下载') }
  if (response.status === 404) throw new ArcadeError(404, '作品不存在或已取消发布')
  if (!response.ok) throw new ArcadeError(response.status, `游戏包下载失败（HTTP ${response.status}）`)
  if (Number(response.headers.get('content-length') ?? 0) > MAX_PACKAGE) throw new ArcadeError(413, '游戏包超过 256 MiB，网页播放器无法加载')
  const buffer = await response.arrayBuffer()
  if (!buffer.byteLength) throw new ArcadeError(0, '游戏包为空，无法运行')
  if (buffer.byteLength > MAX_PACKAGE) throw new ArcadeError(413, '游戏包超过 256 MiB，网页播放器无法加载')
  return new Uint8Array(buffer)
}

/** 发布时记录的引擎版本与当前播放器引擎的关系；mismatch 时游玩页面需要给出警告。 */
export function engineCompatibility(commit: string): 'match' | 'legacy' | 'mismatch' {
  const legacy: string[] = legacyEngineCommits ?? []
  return commit === engineCommit ? 'match' : legacy.includes(commit) ? 'legacy' : 'mismatch'
}
