import { parseDocument } from 'yaml'
import { assertHandle, EngineError } from './protocol.ts'

export interface PositionCheck { entity_id: string; axis: 'x' | 'y' | 'z'; min: number; max: number; stable_tolerance?: number }
export interface RuntimeValidation { scene_version: string; steps: number; sample_every: number; checks: PositionCheck[] }
export function validateRuntimeRequest(input: RuntimeValidation) {
  if (!input || typeof input.scene_version !== 'string' || !Number.isInteger(input.steps) || input.steps < 1 || input.steps > 600 ||
    !Number.isInteger(input.sample_every) || input.sample_every < 1 || input.sample_every > input.steps || Math.ceil(input.steps / input.sample_every) > 60 ||
    !Array.isArray(input.checks) || input.checks.length < 1 || input.checks.length > 16) throw new EngineError('INVALID_ARGUMENT', 'Use 1–600 steps, at most 60 sampling intervals and 1–16 position checks.')
  for (const check of input.checks) {
    try { assertHandle(check.entity_id) } catch { throw new EngineError('INVALID_ARGUMENT', 'Invalid entity ID') }
    if (!['x', 'y', 'z'].includes(check.axis) || !Number.isFinite(check.min) || !Number.isFinite(check.max) || check.min > check.max ||
      (check.stable_tolerance !== undefined && (!Number.isFinite(check.stable_tolerance) || check.stable_tolerance < 0 || input.steps < 2 * input.sample_every))) throw new EngineError('INVALID_ARGUMENT', 'Invalid bounds or stability window (requires at least three samples).')
  }
}
export function runtimePositions(archive: string, ids: string[]) {
  if (archive.length > 4 * 1024 * 1024) throw new EngineError('INVALID_RUNTIME_STATE', 'Runtime archive exceeds limit')
  const doc = parseDocument(archive, { intAsBigInt: true, uniqueKeys: true })
  if (doc.errors.length) throw new EngineError('INVALID_RUNTIME_STATE', 'Invalid runtime archive')
  const value = doc.toJS({ maxAliasCount: 0 })
  if (!Array.isArray(value?.Entities)) throw new EngineError('INVALID_RUNTIME_STATE', 'Runtime entities missing')
  const entities = new Map<string, any>(value.Entities.map((e: any) => [String(e.Entity), e]))
  return Object.fromEntries(ids.map(id => {
    const entity = entities.get(id)
    const transform = entity?.Components?.find((c: any) => c.StableName === 'TomCat.Transform')
    const raw = transform?.Properties?.find((p: any) => p.StableName === 'Translation')?.Value ?? entity?.Transform?.Translation
    const position = Array.isArray(raw) && raw.length === 3 ? raw.map(Number) : null
    return [id, position?.every(Number.isFinite) ? position : null]
  })) as Record<string, number[] | null>
}
/** Runs synchronously on the host thread, so no display frames or human edits interleave. */
export function runFixedValidation(input: RuntimeValidation, rpc: <T = any>(type: string, payload?: Record<string, unknown>) => T) {
  validateRuntimeRequest(input)
  const samples: { step: number; frames: number; positions: Record<string, number[] | null> }[] = []
  const ids = [...new Set(input.checks.map(c => c.entity_id))]
  const sample = (step: number) => {
    const state = rpc<{ archive: string; frames: number }>('preview.snapshot')
    samples.push({ step, frames: state.frames, positions: runtimePositions(state.archive, ids) })
  }
  try {
    rpc('preview.control', { command: 'play' })
    rpc('preview.control', { command: 'pause' })
    sample(0)
    for (let step = 1; step <= input.steps; step++) {
      rpc('preview.control', { command: 'step' })
      if (step % input.sample_every === 0 || step === input.steps) sample(step)
    }
  } finally { rpc('preview.control', { command: 'stop' }) }
  const checks = input.checks.map(check => {
    const axis = { x: 0, y: 1, z: 2 }[check.axis]
    const values = samples.map(s => s.positions[check.entity_id]?.[axis] ?? null)
    const actual = values[values.length - 1]!
    const tail = values.slice(-3)
    const finite = values.every(v => v !== null && Number.isFinite(v))
    const spread = finite ? Math.max(...tail as number[]) - Math.min(...tail as number[]) : null
    const passed = finite && actual !== null && actual >= check.min && actual <= check.max &&
      (check.stable_tolerance === undefined || (tail.length === 3 && spread !== null && spread <= check.stable_tolerance))
    return { ...check, actual, spread, passed }
  })
  return { passed: checks.every(c => c.passed), scene_version: input.scene_version, steps: input.steps, fixed_delta_seconds: 1 / 60, checks, samples,
    scope: 'Sampled world positions and final bounds; not a log, collision-event, performance or gameplay-quality verdict.' }
}
