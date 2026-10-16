// Count the production batch size, retaining support for historical one-kill
// records. Totals are cumulative run counters and must not be summed as deltas.
export function killCounts(window) {
  let cleared = Boolean(window.wasClearedAtStart), killsBeforeClear = 0, killsAfterClear = 0
  for (const message of window.logs) for (const line of message.split(/\r?\n/)) {
    if (line.includes('[Rougelike] clear')) cleared = true
    const marker = '[Rougelike] kill:', at = line.indexOf(marker)
    if (at < 0) continue
    const parsed = /^(\d+)\s+remaining:(\d+)(?:\s+count:(\d+))?\s*$/.exec(line.slice(at + marker.length))
    if (!parsed) throw new Error(`Malformed Rougelike kill record: ${line}`)
    const total = Number(parsed[1]), remaining = Number(parsed[2]), count = parsed[3] === undefined ? 1 : Number(parsed[3])
    if (![total, remaining, count].every(Number.isSafeInteger) || count < 1 || count > total)
      throw new Error(`Invalid Rougelike kill count: ${line}`)
    if (cleared) killsAfterClear += count
    else killsBeforeClear += count
  }
  return { kills: killsBeforeClear + killsAfterClear, killsBeforeClear, killsAfterClear }
}
