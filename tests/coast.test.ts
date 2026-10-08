import { test } from 'node:test'
import assert from 'node:assert/strict'
import { coastPath } from '../src/coast.js'
const count = (d: string, letter: string) => d.split(letter).length - 1

test('an island tile is one closed loop with a curve round each corner', () => {
  const d = coastPath(['...', '.#.', '...'])
  assert.deepEqual([count(d, 'M'), count(d, 'Q'), count(d, 'Z')], [1, 4, 1])
})

test('tiles touching at a corner still close every loop they start', () => {
  const d = coastPath(['....', '.#..', '..#.', '....'])
  assert.ok(count(d, 'M') >= 1)
  assert.equal(count(d, 'M'), count(d, 'Z'))
})

test('a coast along the edge runs off the frame', () => {
  const land = ['######', '......', '......'], xs: number[] = []
  coastPath(land, (x, y) => { xs.push(x); return [x, y] })
  assert.ok(Math.min(...xs) < 0)
  assert.ok(Math.max(...xs) > land[0]!.length)
})

test('the same map always gives the same coast, in either orientation', () => {
  const land = ['..##.', '.###.', '.....', '#....']
  assert.equal(coastPath(land), coastPath([...land]))
  // A quarter turn moves every point but keeps the shapes.
  assert.equal(count(coastPath(land, (x, y) => [4 - y, x]), 'Q'), count(coastPath(land), 'Q'))
})
