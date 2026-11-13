import test from 'node:test'
import assert from 'node:assert/strict'
import { isProjects, isScene } from '../src/ui/data.ts'

test('changing showcase artwork preserves valid existing local projects and scenes', () => {
  for (const image of ['/images/forest.webp', '/images/desert.webp', '/images/puzzle.webp', '/images/rougelike.png', '/samples/shelter/cover.png', '/v1/games/return/cover', '/v1/games/physics-lab/cover']) {
    assert.ok(isProjects([{ id: 'user-project', name: 'My project', template: '2D', image, status: 'draft', updated: '', description: '' }]))
    assert.ok(isScene({ sceneName: 'My scene', objects: [], background: image }))
  }
  assert.equal(isScene({ sceneName: 'Bad scene', objects: [], background: 'javascript:alert(1)' }), false)
})
