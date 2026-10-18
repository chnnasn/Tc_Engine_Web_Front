import type { Topic } from './data'

export interface Page<T> { items: T[]; total: number }
export interface Reply { id: string; text: string; author: string; time: string; ownerId?: string; avatarUrl?: string | null; isAdmin?: boolean }
export async function siteApi<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/v1${path}`, {
    method, credentials: 'same-origin', signal: AbortSignal.timeout(30000),
    headers: { 'X-TomCat-Request': '1', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('tomcat-auth-expired'))
    let message = response.status === 401 ? '请先登录账号。' : response.status === 403 ? '当前账号没有此操作权限。' : response.status === 404 ? '内容不存在或已被移除。' : response.status === 429 ? '操作过于频繁，请稍后重试。' : '请求失败，请稍后重试。'
    try { message = (await response.json()).error || message } catch { /* Empty error response. */ }
    throw new Error(message)
  }
  if (response.status === 204) return undefined as T
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('服务连接失败，请稍后重试。')
  return response.json()
}
export const listTopics = (offset = 0, category = '', q = '') => siteApi<Page<Topic>>(`/community/topics?${new URLSearchParams({ offset: String(offset), category, q })}`)
export const getTopic = (id: string) => siteApi<Topic>(`/community/topics/${encodeURIComponent(id)}`)
export const createTopic = (title: string, content: string, category: string) => siteApi<Topic>('/community/topics', 'POST', { title, content, category })
export const listReplies = (id: string, offset = 0) => siteApi<Page<Reply>>(`/community/topics/${encodeURIComponent(id)}/replies?offset=${offset}`)
export const createReply = (id: string, content: string) => siteApi<Reply>(`/community/topics/${encodeURIComponent(id)}/replies`, 'POST', { content })
export function communityTime(time: string) {
  const date = new Date(time)
  return Number.isNaN(date.getTime()) ? time : date.toLocaleString('zh-CN')
}
