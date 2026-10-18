export type Game = {
  id: string; title: string; subtitle: string; author: string; category: string;
  image: string; color: string; plays?: string; likes?: number; duration?: string; description: string;
  packageUrl?: string;
  sourceUrl?: string;
  controls?: { key: string; action: string }[];
}
export const games: Game[] = [
  {
    id: 'return', title: 'Return / Echo World', subtitle: '切换生死世界，推动箱子、触发机关。',
    author: 'Tc 引擎示例', category: '解谜', image: '/samples/return/cover.png', color: '#cbd8d2',
    packageUrl: '/samples/return/return.tcpak',
    sourceUrl: '/samples/return/return-source.zip',
    description: '基于 Unity Return 工程的像素平台解谜示例。触碰尖刺切换生死世界，观察两侧地形，推动箱子、压住按钮。包含教学关、五个关卡与最终场景，以 Tc 引擎复原。',
    controls: [
      { key: 'A / D 或 ← / →', action: '左右移动' }, { key: 'Space', action: '跳跃' },
      { key: 'R', action: '重新开始当前关卡' }, { key: 'Enter', action: '开始游戏' },
      { key: 'P', action: '暂停 / 继续' }, { key: 'M', action: '静音 / 开启声音' },
    ],
  },
  {
    id: 'shelter', title: 'Shelter · 避难所', subtitle: '风暴将至，为居民留下一处家园。',
    author: 'Tc 引擎示例', category: '策略', image: '/samples/shelter/gameplay.png', color: '#bd9c6d',
    packageUrl: '/samples/shelter/shelter.tcpak', sourceUrl: '/samples/shelter/shelter-source.zip',
    description: '派遣居民探索，收集木材与石材，在内圈建造农场、外圈建造城墙。应对每日食物消耗与逐渐增强的风暴，守住避难所直到第 29 天。保留 Shelter 原始手绘素材、音乐和资源循环，以 Tc 原生 C# 复原。',
    controls: [{ key: '点击空地', action: '打开建造预览，再确认或取消' }, { key: '右下角派遣', action: '打开窗口，拖动滑块选人数后确认' }, { key: '探索完成', action: '在结果窗口领取资源' }, { key: '右上角设置', action: '暂停、调整速度与声音、返回菜单' }, { key: 'Esc', action: '取消当前操作 / 打开设置' }, { key: 'Enter', action: '确认当前窗口' }],
  },
  {
    id: 'rougelike', title: 'Rougelike · 几何竞技场', subtitle: '挥出刀光，在十波围攻中找到自己的节奏。',
    author: 'Tc 引擎示例', category: '动作', image: '/samples/rougelike/cover.png', color: '#f7f7e2',
    packageUrl: '/samples/rougelike/rougelike.tcpak',
    sourceUrl: '/samples/rougelike/rougelike-source.zip',
    description: '走进几何竞技场，用前斩与后斩迎击不断涌来的敌人。不断走位，抓准时机放慢时间或释放黑洞，在每一波战斗之后选择升级，挑战全部十波敌人。靠近菜单和升级选项，挥刀击破即可选择；也可以使用键盘快捷键。基于原始 Rougelike demo，以 Tc 引擎复原。',
    controls: [
      { key: 'W A S D', action: '移动' }, { key: '鼠标', action: '瞄准方向' },
      { key: '左键', action: '前斩' }, { key: '右键', action: '后斩' },
      { key: '按住 Shift', action: '时间凝滞（强化解锁）' }, { key: 'R', action: '黑洞（强化解锁）' },
      { key: '长按左键', action: '蓄力斩（强化解锁）' },
      { key: '1 / 2 / 3', action: '选择升级' }, { key: 'E', action: '重抽强化（共 3 次）' },
      { key: 'Enter', action: '开始 / 重试' }, { key: 'M', action: '结束后返回菜单' },
      { key: 'P', action: '暂停 / 继续' },
    ],
  },
  { id: 'physics-lab', title: 'Physics Lab · 物理实验室', subtitle: '观察重力、旋转与碰撞如何发生。', author: 'Tc 引擎示例', category: '物理', image: '/samples/physics-lab/cover.png', color: '#d8e1d0', packageUrl: '/samples/physics-lab/physics-lab.tcpak', description: '一个自动运行的 2D 刚体实验：四个不同大小和角度的方块从空中落下，与静态地面碰撞，逐渐停稳。用于观察 Tc 引擎的重力、旋转与接触响应。停止后重新加载即可再次观察，没有额外的角色或关卡玩法。' },
]
export type Project = { id: string; name: string; template: '2D' | '空白'; image: string; status: 'draft' | 'published'; updated: string; description: string }
export const initialProjects: Project[] = [
  { id: 'my-forest', name: '物理实验室', template: '2D', image: '/samples/physics-lab/cover.png', status: 'draft', updated: '今天 14:32', description: '观察刚体下落与地面碰撞。' },
  { id: 'my-puzzle', name: '碰撞练习', template: '2D', image: '/samples/physics-lab/cover.png', status: 'published', updated: '昨天 18:06', description: '试着从另一个角度看世界。' },
  { id: 'my-first-game', name: '我的第一个游戏', template: '空白', image: '', status: 'draft', updated: '9 月 8 日', description: '从一个想法开始。' },
]
export type Topic = { id: string; title: string; category: string; author: string; avatar: string; color: string; time: string; replies: number; content: string; pinned?: boolean; ownerId?: string; avatarUrl?: string | null; isAdmin?: boolean }
export const initialTopics: Topic[] = [
  { id: 'welcome', title: '欢迎来到 TomCat，聊聊你想做的第一个游戏', category: '综合讨论', author: 'TomCat', avatar: 'T', color: '#e5ece4', time: '2 小时前', replies: 24, pinned: true, content: '每个游戏都从一个小小的想法开始。也许是一段想讲的故事，也许是一个突然冒出的玩法，或者只是想造一个可以四处走走的世界。\n\n这里是大家交流创作的地方。欢迎分享你的想法，也欢迎从试玩和留言开始。\n\n如果时间、技术都不是问题，你最想做一个什么样的游戏？' },
  { id: 'forest-devlog', title: '《物理实验室》开发手记：让森林里多一点生活的痕迹', category: '开发日志', author: '木木', avatar: '木', color: '#ece5d9', time: '36 分钟前', replies: 12, content: '这周没有添加新关卡，而是回头补了一些很小的细节：门口没有收走的鞋子，晾衣绳上的围巾，还有桥边那块总是被踩松的木板。\n\n很有意思的是，这些没有直接参与玩法的物件，反而让这个地方更像有人生活。接下来想试试让居民有自己的小日程。\n\n你们会注意游戏里这些不起眼的细节吗？' },
  { id: 'first-puzzle', title: '第一次做解谜关卡，怎样让提示自然一点？', category: '创作求助', author: '一格', avatar: '一', color: '#e3e8ee', time: '1 小时前', replies: 8, content: '最近在做一个关于视角的解谜原型。自己设计的关卡太熟悉了，很难判断玩家会不会在第一步就卡住。\n\n目前尝试通过颜色和场景里的重复形状来提示，但又担心答案给得太直接。大家通常怎样安排第一个教学关卡？' },
  { id: 'weekend', title: '周末做了个十分钟的小冒险，想听听大家的感受', category: '作品分享', author: '迟岛', avatar: '迟', color: '#f0e4d9', time: '3 小时前', replies: 6, content: '用周末的时间把一直放在备忘录里的沙漠故事做了一个小样。只有三个场景，没有复杂的操作，主要想试试画面和声音一起讲故事。\n\n作品叫《重力练习》。特别想听听大家对结尾的理解，欢迎在这里留下想法。' },
  { id: 'resources', title: '分享一些整理游戏素材的小习惯', category: '经验分享', author: '小北', avatar: '北', color: '#e9e6ee', time: '昨天', replies: 16, content: '以前素材多起来以后，经常找不到上次改过的那张图。现在习惯按用途分目录，再给素材附上一句简单说明。\n\n另一个有帮助的小习惯是保留原始文件，把导出的版本放到独立目录。虽然开始时多了一步，回头调整会轻松很多。' },
]
export const topicCategories = ['全部话题', '综合讨论', '作品分享', '开发日志', '创作求助', '经验分享']
export function uid() { return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}` }
export function nowLabel() { return new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const strings = (value: Record<string, unknown>, keys: string[]) => keys.every(key => typeof value[key] === 'string')
export const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(x => typeof x === 'string')
const legacyArtwork = new Set(['/images/forest.webp', '/images/puzzle.webp', '/images/desert.webp', '/images/rougelike.png', '/samples/shelter/cover.png'])
const knownArtwork = (image: unknown) => image === '' || (typeof image === 'string' && (legacyArtwork.has(image) || games.some(game => game.image === image)))
export const isProjects = (value: unknown): value is Project[] => Array.isArray(value) && value.every(p => record(p) && strings(p, ['id', 'name', 'image', 'updated', 'description']) && /^[a-zA-Z0-9_-]+$/.test(p.id as string) && ['draft', 'published'].includes(p.status as string) && ['2D', '空白'].includes(p.template as string) && knownArtwork(p.image)) && new Set(value.map(p => p.id)).size === value.length
export const isTopics = (value: unknown): value is Topic[] => Array.isArray(value) && value.every(t => record(t) && strings(t, ['id', 'title', 'category', 'author', 'avatar', 'color', 'time', 'content']) && /^[a-zA-Z0-9_-]+$/.test(t.id as string) && typeof t.replies === 'number' && Number.isFinite(t.replies) && t.replies >= 0) && new Set(value.map(t => t.id)).size === value.length
export type LocalComment = { id: string; text: string }
export const isComments = (value: unknown): value is LocalComment[] => Array.isArray(value) && value.every(c => record(c) && strings(c, ['id', 'text']))
export type SceneObject = { id: string; name: string; type: 'sprite' | 'camera' | 'group'; x: number; y: number; rotation: number; scale: number; visible: boolean }
export type Scene = { sceneName: string; objects: SceneObject[]; background: string }
export const isScene = (s: unknown): s is Scene => record(s) && typeof s.sceneName === 'string' && s.sceneName.length <= 64 && typeof s.background === 'string' && knownArtwork(s.background) && Array.isArray(s.objects) && s.objects.length <= 100 && s.objects.every(o => record(o) && strings(o, ['id', 'name']) && (o.name as string).length <= 40 && ['camera', 'sprite', 'group'].includes(o.type as string) && typeof o.visible === 'boolean' && [o.x, o.y, o.rotation, o.scale].every(v => typeof v === 'number' && Number.isFinite(v)) && Math.abs(o.x as number) <= 1000 && Math.abs(o.y as number) <= 1000 && Math.abs(o.rotation as number) <= 360 && (o.scale as number) >= .1 && (o.scale as number) <= 4) && new Set(s.objects.map(o => o.id)).size === s.objects.length
