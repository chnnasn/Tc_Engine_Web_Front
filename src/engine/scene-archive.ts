// 场景归档（SceneArchiveCodec YAML）里的 CSharpScripts 组件是"作者态"数据：
// 引擎把它注册为 AddableInInspector=false，且没有可 patch 的属性，因此编辑器协议
// （component.add / component.patch）无法挂载脚本。AI/宿主 RPC 把组件记录注入
// 归档 YAML 再走 scene.loadArchive；用户交互则直接使用原生 Inspector 拖拽和移除。
//
// 归档由引擎的 YAML::Emitter 生成，格式非常规整（固定 2 空格缩进、无空行、无锚点），
// 因此这里用行级编辑而不是引入 YAML 依赖。注入结果仍会被引擎的 Decode 校验，
// 格式错误会在 loadArchive 时以 INVALID_SCENE 拒绝，不会静默写坏场景。

/** ComponentIds::CSharpScripts（见上游 ComponentRegistry.h），十进制避免 BigInt 字面量。 */
export const CSHARP_SCRIPTS_TYPE_ID = '11457157452030541833'
export const CSHARP_SCRIPTS_STABLE_NAME = 'TomCat.CSharpScripts'
/** BaseDescriptor 的默认 SchemaVersion。 */
export const CSHARP_SCRIPTS_SCHEMA_VERSION = 1

export interface ScriptAttachment {
  /** 脚本资产 Handle，必须与 Assets/Scripts/*.cs.tcmeta 及 ScriptAssets.json 一致。 */
  handle: string
  /** 类名，引擎用它匹配托管类型。 */
  className: string
  /** 挂载点标识；不传则调用方需保证唯一。 */
  attachmentId?: string
}

const entityPattern = /^ {2}- Entity: (\d+)$/
const sequenceItemPattern = /^ {6}- /

/** 定位实体下 `    Components:` 行的下标；找不到返回 -1。 */
function componentsLine(lines: string[], entityId: string) {
  const start = lines.findIndex(line => {
    const match = entityPattern.exec(line)
    return match !== null && match[1] === entityId
  })
  if (start < 0) return -1
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index] === '    Components:') return index
    // 下一个实体开始 → 当前实体没有 Components 段。
    if (entityPattern.test(lines[index]!)) return -1
  }
  return -1
}

/** `Components:` 序列的结束下标（下一个缩进 < 6 的非空行）。 */
function sequenceEnd(lines: string[], components: number) {
  let index = components + 1
  while (index < lines.length) {
    const line = lines[index]!
    if (line.trim() === '' || /^ {6}/.test(line)) { index += 1; continue }
    break
  }
  return index
}

/** 序列中某个条目的结束下标（下一个同级条目或序列末尾）。 */
function itemEnd(lines: string[], from: number, to: number) {
  let index = from + 1
  while (index < to && !sequenceItemPattern.test(lines[index]!)) index += 1
  return index
}

/** 去掉指定实体上已有的 CSharpScripts 记录，返回新的行数组与该段是否原本存在。 */
function stripScripts(lines: string[], components: number) {
  const to = sequenceEnd(lines, components)
  const kept: string[] = []
  let removed = false
  let index = components + 1
  while (index < to) {
    const line = lines[index]!
    if (sequenceItemPattern.test(line) && line.trim() === `- TypeId: ${CSHARP_SCRIPTS_TYPE_ID}`) {
      index = itemEnd(lines, index, to)
      removed = true
      continue
    }
    kept.push(line)
    index += 1
  }
  return { kept, removed, tail: lines.slice(to) }
}

function attachmentLines(attachment: ScriptAttachment) {
  const attachmentId = attachment.attachmentId ?? randomAttachmentId()
  if (!/^[1-9]\d*$/.test(attachmentId)) throw new Error('AttachmentID 必须是非零十进制整数')
  if (!/^[1-9]\d*$/.test(attachment.handle)) throw new Error('脚本 Handle 无效，请先保存脚本')
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(attachment.className)) throw new Error('脚本类名无效')
  return [
    `            - AttachmentID: ${attachmentId}`,
    '              Enabled: true',
    `              ScriptHandle: ${attachment.handle}`,
    `              ClassName: ${attachment.className}`,
    '              Fields: []',
  ]
}

/** 每个挂载点需要一个非零且实体内唯一的 uint64。 */
export function randomAttachmentId() {
  const bits = crypto.getRandomValues(new Uint32Array(2))
  const value = ((BigInt(bits[0]!) << 32n) | BigInt(bits[1]!)) || 1n
  return value.toString()
}

/**
 * 把 CSharpScripts 记录注入指定实体（替换该实体上已有的记录）。
 * 返回新的归档字符串；实体不存在或缺少 Components 段时抛错。
 */
export function attachScripts(archive: string, entityId: string, attachments: ScriptAttachment[]): string {
  if (!attachments.length) throw new Error('至少需要一个脚本')
  const lines = archive.split('\n')
  const components = componentsLine(lines, entityId)
  if (components < 0) throw new Error(`场景中找不到可挂载脚本的实体 ${entityId}`)
  const { kept, tail } = stripScripts(lines, components)
  const head = lines.slice(0, components + 1)
  const block = [
    `      - TypeId: ${CSHARP_SCRIPTS_TYPE_ID}`,
    `        StableName: ${CSHARP_SCRIPTS_STABLE_NAME}`,
    `        SchemaVersion: ${CSHARP_SCRIPTS_SCHEMA_VERSION}`,
    '        Properties:',
    '          Scripts:',
    ...attachments.flatMap(attachmentLines),
  ]
  return [...head, ...block, ...kept, ...tail].join('\n')
}

/** 移除指定实体上的 CSharpScripts 记录；实体上没有记录时返回原归档。 */
export function detachScripts(archive: string, entityId: string): string {
  const lines = archive.split('\n')
  const components = componentsLine(lines, entityId)
  if (components < 0) return archive
  const { kept, removed, tail } = stripScripts(lines, components)
  if (!removed) return archive
  return [...lines.slice(0, components + 1), ...kept, ...tail].join('\n')
}

/** Edit one attachment while preserving every existing ID, enabled flag and stored field. */
export function editScriptAttachment(archive: string, entityId: string, change: ScriptAttachment | string): string {
  const lines = archive.split('\n')
  const components = componentsLine(lines, entityId)
  if (components < 0) throw new Error('Entity does not exist')
  const to = sequenceEnd(lines, components)
  const start = lines.findIndex((line, index) => index > components && index < to && line.trim() === `- TypeId: ${CSHARP_SCRIPTS_TYPE_ID}`)
  if (typeof change !== 'string' && readScripts(archive, entityId).some(item => item.handle === change.handle)) return archive
  if (start < 0) {
    if (typeof change === 'string') throw new Error('Script attachment does not exist')
    return attachScripts(archive, entityId, [change])
  }
  const end = itemEnd(lines, start, to)
  if (typeof change === 'string') {
    const item = lines.findIndex((line, index) => index > start && index < end && line === `            - AttachmentID: ${change}`)
    if (item < 0) throw new Error('Script attachment does not exist')
    let next = item + 1
    while (next < end && !/^ {12}- AttachmentID:/.test(lines[next]!)) next++
    lines.splice(item, next - item)
    const result = lines.join('\n')
    return readScripts(result, entityId).length ? result : detachScripts(result, entityId)
  }
  const scripts = lines.findIndex((line, index) => index > start && index < end && /^ {10}Scripts:/.test(line))
  if (scripts < 0) throw new Error('Invalid CSharpScripts archive')
  lines[scripts] = '          Scripts:'
  lines.splice(end, 0, ...attachmentLines(change))
  return lines.join('\n')
}

/** 读取指定实体当前挂载的脚本（用于 UI 回显）。 */
export function readScripts(archive: string, entityId: string): ScriptAttachment[] {
  const lines = archive.split('\n')
  const components = componentsLine(lines, entityId)
  if (components < 0) return []
  const to = sequenceEnd(lines, components)
  const attachments: ScriptAttachment[] = []
  let index = components + 1
  while (index < to) {
    const line = lines[index]!
    if (sequenceItemPattern.test(line) && line.trim() === `- TypeId: ${CSHARP_SCRIPTS_TYPE_ID}`) {
      const end = itemEnd(lines, index, to)
      let handle = '', className = '', attachmentId = ''
      for (let cursor = index; cursor < end; cursor += 1) {
        const handleMatch = /^\s+ScriptHandle: (\d+)$/.exec(lines[cursor]!)
        const classMatch = /^\s+ClassName: (.+)$/.exec(lines[cursor]!)
        const attachmentMatch = /^\s+- AttachmentID: (\d+)$/.exec(lines[cursor]!)
        if (attachmentMatch) {
          if (handle) attachments.push({ handle, className, attachmentId })
          handle = ''; className = ''; attachmentId = attachmentMatch[1]!
        }
        if (handleMatch) handle = handleMatch[1]!
        if (classMatch) className = classMatch[1]!.trim()
      }
      if (handle) attachments.push({ handle, className, attachmentId })
      index = end
      continue
    }
    index += 1
  }
  return attachments
}
