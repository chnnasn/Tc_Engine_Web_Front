import { games, isScene, type Project, type Scene } from './data'
import { assertDocument, readEngineProject, type EngineDocument } from '../engine/storage'

function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${name.replace(/[<>:"/\\|?*]/g, '-')}.tomcat.json`
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function downloadProject(project: Project, engine: EngineDocument) {
  download(project.name, { format: 'tomcat-project', version: 2, project, engine })
}
export async function exportProject(project: Project) {
  const engine = await readEngineProject(project.id)
  if (engine) { downloadProject(project, engine); return }
  const stored: unknown = JSON.parse(localStorage.getItem(`tomcat-ui-scene-${project.id}`) || 'null')
  if (stored !== null && !isScene(stored)) throw new Error('旧场景数据损坏，无法导出')
  download(project.name, { format: 'tomcat-static-project', version: 1, project, scene: stored })
}
export async function readProjectFile(file: File): Promise<{ project: Omit<Project, 'id' | 'updated'>; scene: Scene | null; engine?: EngineDocument }> {
  if (file.size > 64 * 1024 * 1024) throw new Error('项目文件不能超过 64 MiB')
  const data: unknown = JSON.parse(await file.text())
  if (!isRecord(data) || !isRecord(data.project) || typeof data.project.name !== 'string' || !data.project.name.trim()) throw new Error('无效的项目文件')
  const raw = data.project
  let scene: Scene | null = null
  let engine: EngineDocument | undefined
  if (data.format === 'tomcat-project' && data.version === 2) {
    assertDocument(data.engine); engine = data.engine
  } else if (data.format === 'tomcat-static-project' && data.version === 1) {
    if (data.scene != null && !isScene(data.scene)) throw new Error('无效的旧场景')
    scene = (data.scene as Scene | null) ?? null
  } else throw new Error('不支持的项目格式')
  return {
    project: { name: String(raw.name).trim().slice(0, 32), template: raw.template === '2D' ? '2D' : '空白', image: games.some(game => game.image === raw.image) ? String(raw.image) : '', status: 'draft', description: typeof raw.description === 'string' ? raw.description.slice(0, 300) : '' },
    scene, engine,
  }
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
