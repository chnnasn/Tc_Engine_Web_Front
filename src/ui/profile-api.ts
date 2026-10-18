import { siteApi, type Page } from './community-api'
import type { Topic } from './data'
export interface UserProfile { id: string; displayName: string; avatarUrl: string | null; isAdmin: boolean; createdAt: string; topics: number; publishedGames: number }
export async function userProfile(id: string) {
  const profile = await siteApi<UserProfile>(`/users/${encodeURIComponent(id)}`)
  if (typeof profile.id !== 'string' || typeof profile.displayName !== 'string' || typeof profile.createdAt !== 'string') throw new Error('个人主页服务暂不可用，请稍后重试。')
  return profile
}
export const userTopics = (id: string, offset = 0) => siteApi<Page<Topic>>(`/users/${encodeURIComponent(id)}/topics?offset=${offset}`)
export const updateDisplayName = (displayName: string) => siteApi('/users/me/profile', 'PUT', { displayName })
export async function uploadAvatar(file: File) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) throw new Error('请选择不超过 8 MB 的 PNG、JPEG 或 WebP 图片。')
  const image = await createImageBitmap(file)
  let blob: Blob
  try {
    if (image.width > 8192 || image.height > 8192) throw new Error('图片尺寸过大，请选择边长不超过 8192 像素的图片。')
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256
    const context = canvas.getContext('2d')!
    const side = Math.min(image.width, image.height)
    context.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, 256, 256)
    blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('图片处理失败，请重试。')), 'image/png'))
  } finally { image.close() }
  const response = await fetch('/v1/users/me/avatar', { method: 'PUT', credentials: 'same-origin', signal: AbortSignal.timeout(30000), headers: { 'Content-Type': 'image/png', 'X-TomCat-Request': '1' }, body: blob })
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('tomcat-auth-expired'))
    throw new Error(response.status === 413 ? '头像文件过大，请换一张图片。' : '头像上传失败，请确认登录状态后重试。')
  }
}
