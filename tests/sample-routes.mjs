import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const entries = [
  ['return', 'Return / Echo World', '切换生死世界，推动箱子、触发机关。', '解谜', '#cbd8d2', 'public/samples/return/cover.png', 'public/samples/return/return.tcpak', 'public/samples/return/return-source.zip'],
  ['shelter', 'Shelter · 避难所', '风暴将至，为居民留下一处家园。', '策略', '#bd9c6d', 'public/samples/shelter/gameplay.png', 'public/samples/shelter/shelter.tcpak', 'public/samples/shelter/shelter-source.zip'],
  ['rougelike', 'Rougelike · 几何竞技场', '挥出刀光，在十波围攻中找到自己的节奏。', '动作', '#f7f7e2', 'public/samples/rougelike/cover.png', 'public/samples/rougelike/rougelike.tcpak', 'public/samples/rougelike/rougelike-source.zip'],
  ['physics-lab', 'Physics Lab · 物理实验室', '观察重力、旋转与碰撞如何发生。', '物理', '#d8e1d0', 'public/samples/physics-lab/cover.png', 'public/samples/physics-lab/physics-lab.tcpak', null],
]
const files = Object.fromEntries(entries.map(([id, , , , , cover, pack, source]) => [id, { cover, package: pack, source }]))
const catalog = entries.map(([id, title, subtitle, category, color, , , source]) => ({
  id, title, subtitle, author: 'Tc 引擎示例', category, color, description: subtitle,
  image: `/v1/games/${id}/cover`,
  sourceUrl: source ? `/v1/games/${id}/source` : null,
}))

export function fulfillSamples(route) {
  const path = new URL(route.request().url()).pathname
  if (path === '/v1/games') {
    route.fulfill({ json: catalog })
    return true
  }
  const match = path.match(/^\/v1\/games\/([a-z0-9-]+)\/(package|cover|source)$/)
  const sample = match && files[match[1]]
  const file = sample?.[match[2]]
  if (!match || !sample) return false
  if (!file) {
    route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: '没有这个示例游戏包。' }) })
    return true
  }
  const type = match[2] === 'cover' ? 'image/png' : match[2] === 'source' ? 'application/zip' : 'application/octet-stream'
  route.fulfill({ body: readFileSync(join(root, file)), contentType: type })
  return true
}
