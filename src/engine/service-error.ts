export const serviceUnavailableMessage = '云端服务暂时不可用，请稍后重试'

/** Railway 边缘在进程不存在时返回 404，正文不是业务接口的 error 字段。 */
export function platformUnavailable(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false
  const body = payload as { status?: unknown; message?: unknown; error?: unknown }
  return body.status === 'error' && typeof body.message === 'string' && body.error == null
}
