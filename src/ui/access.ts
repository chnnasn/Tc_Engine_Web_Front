import { inject, type InjectionKey, type Ref } from 'vue'
import type { CloudUser } from '../engine/cloud'

export const accessKey: InjectionKey<{
  user: Ref<CloudUser | undefined>
  requireLogin: () => Promise<boolean>
  openLogin: () => void
}> = Symbol('access')

export function useAccess() {
  const access = inject(accessKey)
  if (!access) throw new Error('账号访问控制尚未初始化')
  return access
}

export function requiresAccount(path: string) {
  return /^\/(editor|projects|profile|preview)(\/|$)/.test(path)
}
