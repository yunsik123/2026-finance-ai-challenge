import assert from 'node:assert/strict'
import { normalizeOcrBoxes } from '../server/trust.ts'

// No real credentials or external calls: simulate the metadata service and clock.
process.env.GOOGLE_APPLICATION_CREDENTIALS = ''
process.env.GOOGLE_CLOUD_PROJECT = 'isolated-ai-test'
process.env.AI_DISABLED = '0'
const originalFetch = globalThis.fetch, originalNow = Date.now
let currentTime = originalNow(), calls = 0, failing = false, invalid = false
Date.now = () => currentTime
globalThis.fetch = async () => {
  calls++
  await Promise.resolve()
  if (failing) throw new Error('simulated metadata outage')
  return Response.json(invalid ? { expires_in: 3600 } : { access_token: 'synthetic-token', expires_in: 3600 })
}
try {
  const provider = await import('../server/ai-provider.ts')
  provider.setAiProvider(await provider.initAiProvider())
  calls = 0
  const tokens = await Promise.all(Array.from({ length: 50 }, () => provider.aiToken()))
  assert(tokens.every(value => value === 'synthetic-token'))
  assert.equal(calls, 1, '50 simultaneous requests must share one credential refresh')
  await provider.aiToken(); assert.equal(calls, 1, 'valid token is cached')
  currentTime += 3600_000; failing = true; calls = 0
  const failed = await Promise.allSettled(Array.from({ length: 20 }, () => provider.aiToken()))
  assert(failed.every(value => value.status === 'rejected')); assert.equal(calls, 1)
  failing = false; invalid = true
  await assert.rejects(provider.aiToken(), 'invalid credential response must not be cached')
  invalid = false
  assert.equal(await provider.aiToken(), 'synthetic-token', 'refresh recovers after failure')
  for (const value of [null, undefined, 4, {}, 'bad']) assert.deepEqual(normalizeOcrBoxes(value), [])
  const boxes = normalizeOcrBoxes([null, undefined, 42, 'bad', {}, [],
    { field: 'total', bbox: [1, 1, 20, 20], confidence: 'bad' },
    { field: 'total', bbox: [1, 1, 20, 20], confidence: .8 }])
  assert(boxes.every(box => Number.isFinite(box.confidence)))
  assert.equal(boxes.at(-1)?.confidence, .8)
  console.log('PASS: AI credential concurrency, cache, outage recovery, invalid tokens and malformed OCR boxes')
} finally { globalThis.fetch = originalFetch; Date.now = originalNow }
