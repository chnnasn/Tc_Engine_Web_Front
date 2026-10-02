import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { repackPackage } from '../scripts/build-sample-games.mjs'

test('v8 scene repacking preserves opaque module payloads and updates digests', () => {
  const headerSize = 64
  const payloads = [Buffer.from('old scene'), Buffer.from('opaque module payload')]
  const base = Buffer.alloc(headerSize + 128 + payloads.reduce((n, p) => n + p.length, 0))
  base.write('TCPACK01')
  base.writeUInt32LE(8, 8)
  base.writeUInt32LE(headerSize, 12)
  base.writeBigUInt64LE(2n, 16)
  let offset = headerSize + 128
  payloads.forEach((payload, i) => {
    const at = headerSize + i * 64
    base.writeBigUInt64LE(i ? 18446744073709551614n : 1n, at)
    base.writeUInt16LE(i ? 0 : 1, at + 8)
    base.writeUInt16LE(i ? 8 : 0, at + 10)
    base.writeBigUInt64LE(BigInt(offset), at + 16)
    base.writeBigUInt64LE(BigInt(payload.length), at + 24)
    payload.copy(base, offset)
    offset += payload.length
  })
  const output = repackPackage(base, 'longer replacement scene')
  assert.equal(output.readUInt32LE(8), 8)
  for (let i = 0; i < 2; i++) {
    const at = headerSize + i * 64
    const start = Number(output.readBigUInt64LE(at + 16))
    const size = Number(output.readBigUInt64LE(at + 24))
    const payload = output.subarray(start, start + size)
    assert.deepEqual(payload, i ? payloads[1] : Buffer.from('longer replacement scene'))
    assert.deepEqual(output.subarray(at + 32, at + 64), createHash('sha256').update(payload).digest())
  }
  assert.equal(output.readBigUInt64LE(headerSize + 64), 18446744073709551614n)
  assert.equal(output.readUInt16LE(headerSize + 74), 8)
})
