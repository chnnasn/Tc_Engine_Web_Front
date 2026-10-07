import { EngineError, type Snapshot } from './protocol.ts'
import { editScriptAttachment, readScripts } from './scene-archive.ts'

interface Script { path: string; handle: string; className: string; text: string }
export interface ScriptHost {
  snapshot(): Snapshot
  scripts(): Script[]
  write(args: { path: unknown; text: unknown }): Script
  compile(validate: () => void): Promise<unknown>
  load(snapshot: Snapshot, archive: string): Snapshot
  installed(): boolean
}
const version = (s: Snapshot) => `${s.sceneHandle}:${s.revision}`
const sourceText = (host: ScriptHost) => JSON.stringify(host.scripts())
const readTools = new Set(['script_list', 'script_read'])
export const scriptExample = `using TomCat;

public sealed class PlayerMovement : TomCatBehaviour
{
    public float Speed = 5f;
    protected override void OnUpdate(float deltaTime)
    {
        float axis = 0f;
        if (Input.IsKeyHeld(KeyCode.A) || Input.IsKeyHeld(KeyCode.Left)) axis -= 1f;
        if (Input.IsKeyHeld(KeyCode.D) || Input.IsKeyHeld(KeyCode.Right)) axis += 1f;
        var position = Transform.Position;
        position.X += axis * Speed * deltaTime;
        Transform.Position = position;
    }
}
`
export const scriptApi = {
  namespace: 'TomCat', base_class: 'TomCatBehaviour',
  callbacks: ['protected override void OnCreate()', 'protected override void OnUpdate(float deltaTime)', 'protected override void OnFixedUpdate(float fixedDeltaTime)', 'protected override void OnDestroy()'],
  input: 'Input.IsKeyHeld(KeyCode.A), KeyCode.D, KeyCode.Left, KeyCode.Right, KeyCode.W, KeyCode.S, KeyCode.Up, KeyCode.Down',
  transform: 'Transform.Position (world) and Transform.LocalPosition are writable TomCat.Vector3 values. Copy, change X/Y/Z, then assign back.',
  logging: 'Log.Info(string message)',
  rules: 'Use a public sealed class matching the .cs filename. Save in Assets/Scripts. Compile before Play. A loaded assembly cannot be replaced in place: restartRequired means the user must rebuild via the C# panel before playing updated code. Source edits are saved by the task checkpoints; scene undo does not undo source edits.',
  example: scriptExample,
}

/** All writes check both scene and source versions at the actual MEMFS boundary. */
export async function executeScriptTool(name: string, args: Record<string, any>, host: ScriptHost): Promise<Record<string, any>> {
  if (!['script_list', 'script_read', 'script_write', 'script_compile', 'script_attach', 'script_detach'].includes(name)) throw new EngineError('UNSUPPORTED_TOOL', name)
  const inspected = host.snapshot(), sources = sourceText(host)
  const sourceVersion = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sources))), byte => byte.toString(16).padStart(2, '0')).join('')
  const validate = () => {
    const current = host.snapshot()
    if (version(current) !== version(inspected)) throw new EngineError('SCENE_CHANGED', 'Scene changed. Inspect it again.')
    if (sourceText(host) !== sources) throw new EngineError('SOURCES_CHANGED', 'Scripts changed. List/read them again before editing.')
    if (!readTools.has(name) && current.mode !== 'edit') throw new EngineError('EDIT_MODE_REQUIRED', 'Stop Play before changing scripts.')
  }
  validate()
  const meta = () => ({ scene_version: version(host.snapshot()), source_version: sourceVersion, installed: host.installed() })
  if (name === 'script_list') return { ...meta(), scripts: host.scripts().map(({ text: _text, ...script }) => script) }
  const path = args.path
  if (['script_read', 'script_write', 'script_attach'].includes(name) && (typeof path !== 'string' || !/^Assets\/Scripts\/[A-Za-z0-9][A-Za-z0-9_.\-/]*\.cs$/.test(path) || path.includes('..'))) throw new EngineError('INVALID_ARGUMENT', 'Path must be a .cs file inside Assets/Scripts.')
  const script = host.scripts().find(s => s.path === path)
  if (name === 'script_read') {
    if (!script) throw new EngineError('SCRIPT_NOT_FOUND', path)
    return { ...meta(), script }
  }
  if (args.scene_version !== version(inspected)) throw new EngineError('SCENE_CHANGED', 'Inspect the scene and pass its scene_version.')
  if (args.source_version !== sourceVersion) throw new EngineError('SOURCES_CHANGED', 'List/read scripts and pass their source_version.')
  if (name === 'script_write') {
    if (typeof args.text !== 'string' || new TextEncoder().encode(args.text).length > 48 * 1024) throw new EngineError('INVALID_ARGUMENT', 'Script text must be at most 48 KiB.')
    host.write({ path, text: args.text })
    // Source writes do not change the scene revision. Return the new content hash.
    return { ...await executeScriptTool('script_read', { path }, host), changed: true }
  }
  if (name === 'script_compile') {
    const compilation = await host.compile(validate)
    return { ...await executeScriptTool('script_list', {}, host), compilation }
  }
  if (!inspected.entities.some(e => e.id === args.entity_id)) throw new EngineError('ENTITY_NOT_FOUND', 'Entity does not exist.')
  if (name === 'script_attach' && (!script || !script.handle)) throw new EngineError('SCRIPT_NOT_FOUND', 'Save the script before attaching it.')
  if (name === 'script_detach' && !readScripts(inspected.archive, args.entity_id).some(a => a.attachmentId === args.attachment_id)) throw new EngineError('ATTACHMENT_NOT_FOUND', 'Read entity_get for actual attachment IDs.')
  const archive = editScriptAttachment(inspected.archive, args.entity_id, name === 'script_attach' ? script! : args.attachment_id)
  const next = archive === inspected.archive ? inspected : host.load(inspected, archive)
  return { ...meta(), attachments: readScripts(next.archive, args.entity_id), changed: archive !== inspected.archive }
}
