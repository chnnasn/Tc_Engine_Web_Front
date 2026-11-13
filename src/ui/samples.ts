import type { Game } from './data'

export async function listSamples(): Promise<Game[]> {
  const response = await fetch('/v1/games', { credentials: 'same-origin', signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new Error('示例列表暂时无法加载')
  const body: unknown = await response.json()
  if (!Array.isArray(body)) throw new Error('示例列表暂时无法加载')
  return body.filter(isSample)
}

function isSample(value: unknown): value is Game {
  if (!value || typeof value !== 'object') return false
  const game = value as Game
  return typeof game.id === 'string' && /^[a-z0-9][a-z0-9-]{0,31}$/.test(game.id) &&
    typeof game.title === 'string' && typeof game.subtitle === 'string' &&
    typeof game.author === 'string' && typeof game.category === 'string' &&
    typeof game.image === 'string' && typeof game.color === 'string' && typeof game.description === 'string'
}
