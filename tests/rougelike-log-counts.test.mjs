import test from 'node:test'
import assert from 'node:assert/strict'
import { killCounts } from './rougelike-log-counts.mjs'

test('kill evidence sums actual batch counts and historical single-kill records', () => {
  assert.deepEqual(killCounts({ logs: [
    '[02:46:24] APP: [Rougelike] kill:1 remaining:59',
    '[02:46:24] APP: [Rougelike] kill:31 remaining:29 count:30',
    '[Rougelike] charge released',
    '[02:46:26] APP: [Rougelike] kill:40 remaining:20 count:9',
  ] }), { kills: 40, killsBeforeClear: 40, killsAfterClear: 0 })
})

test('final batch stays before clear, including multi-line console delivery and later windows', () => {
  assert.deepEqual(killCounts({ logs: [
    '[Rougelike] kill:60 remaining:0 count:20\n[Rougelike] clear kills:60',
    '[Rougelike] kill:61 remaining:0 count:1',
  ] }), { kills: 21, killsBeforeClear: 20, killsAfterClear: 1 })
  assert.deepEqual(killCounts({ wasClearedAtStart: true, logs: [
    '[Rougelike] kill:63 remaining:0 count:2',
    '[Rougelike] kill:64 remaining:0',
  ] }), { kills: 3, killsBeforeClear: 0, killsAfterClear: 3 })
  assert.deepEqual(killCounts({ logs: [] }), { kills: 0, killsBeforeClear: 0, killsAfterClear: 0 })
})

test('invalid batch records fail evidence rather than falling back to one kill', () => {
  for (const count of ['0', '-1', '1.5', 'NaN', '4', '9007199254740992', ''])
    assert.throws(() => killCounts({ logs: [`[Rougelike] kill:3 remaining:0 count:${count}`] }), /Invalid|Malformed/)
})
