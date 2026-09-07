import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'

const base = process.env.MEOKTU_TEST_BASE!
assert(process.env.MEOKTU_ISOLATED_AUDIT === '1' && /^http:\/\/127\.0\.0\.1:889[67]$/.test(base), 'Load testing is restricted to isolated local servers')
const results: any[] = []
const request = async (route: string, token?: string, body?: unknown, host = base) => {
  const response = await fetch(host + route, { method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(30000),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: response.status, body: await response.json().catch(() => null) as any }
}
const legal = (await request('/api/legal')).body
const signup = await request('/api/auth/signup', undefined, { name: '동시요청검증', email: `load-${Date.now()}@meoktu.test`,
  password: 'load1234!', role: 'investor', consent: { version: legal.version, documentIds: legal.required.signup } })
assert.equal(signup.status, 201)
const token = signup.body.token
const state = (await request('/api/public')).body
const funding = state.funds.find((f: any) => f.status === 'funding' && f.goal * .01 >= 20000 && f.goal - f.raised > 20000)

async function measure(name: string, concurrency: number, total: number, operation: (index: number) => Promise<{ status: number }>) {
  let next = 0
  const latencies: number[] = [], statuses: Record<string, number> = {}
  const started = performance.now()
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < total) {
      const index = next++
      const at = performance.now()
      const result = await operation(index)
      latencies.push(performance.now() - at)
      statuses[result.status] = (statuses[result.status] || 0) + 1
    }
  }))
  const elapsed = performance.now() - started
  latencies.sort((a, b) => a - b)
  const percentile = (p: number) => Math.round(latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * p) - 1)])
  const result = { name, concurrency, total, elapsedMs: Math.round(elapsed), requestsPerSecond: +(total / elapsed * 1000).toFixed(1),
    p50Ms: percentile(.5), p95Ms: percentile(.95), maxMs: percentile(1), statuses }
  results.push(result); console.log(JSON.stringify(result))
  return result
}

for (const concurrency of [10, 50, 100]) {
  const routes = ['/api/public', '/api/me', '/api/market/rules', '/api/document-guide']
  const result = await measure('mixed reads', concurrency, concurrency * 4,
    index => request(routes[index % routes.length], token))
  assert.deepEqual(Object.keys(result.statuses), ['200'])
}
for (const concurrency of [10, 50, 100]) {
  const before = (await request('/api/me', token)).body.user.cash
  const result = await measure('concurrent wallet writes', concurrency, concurrency,
    () => request('/api/wallet/topup', token, { amount: 1000 }))
  assert(Object.keys(result.statuses).every(status => ['200', '503'].includes(status)), 'Unexpected write failures')
  const after = (await request('/api/me', token)).body.user.cash
  assert.equal(after - before, (result.statuses['200'] || 0) * 1000, 'Lost or duplicated wallet writes')
}
if (funding) {
  const before = (await request('/api/me', token)).body
  const result = await measure('concurrent investment', 20, 20, () => request(`/api/funds/${funding.id}/invest`, token,
    { amount: 1000, consent: { version: legal.version, documentIds: legal.required.invest, riskAcknowledged: true } }))
  assert.deepEqual(Object.keys(result.statuses), ['200'])
  const after = (await request('/api/me', token)).body
  assert.equal(before.user.cash - after.user.cash, 20000)
  assert.equal(after.positions.find((p: any) => p.fundId === funding.id).amount, 20000)
}
const secondary = process.env.MEOKTU_SECONDARY_BASE
if (secondary) {
  assert.equal(secondary, 'http://127.0.0.1:8898')
  const before = (await request('/api/me', token)).body.user.cash
  const result = await measure('two-instance wallet writes', 40, 40,
    index => request('/api/wallet/topup', token, { amount: 1000 }, index % 2 ? secondary : base))
  assert(Object.keys(result.statuses).every(status => ['200', '503'].includes(status)))
  await new Promise(resolve => setTimeout(resolve, 1600))
  const cash = await Promise.all([base, secondary].map(host => request('/api/me', token, undefined, host).then(r => r.body.user.cash)))
  assert.equal(cash[0], before + (result.statuses['200'] || 0) * 1000, 'Multi-instance lost update')
  assert.equal(cash[0], cash[1], 'Instances disagree after cache refresh')
}
const health = (await request('/api/health')).body
await writeFile(`docs/audit-2026-09-07/load-${health.stateStore}.json`, JSON.stringify({ at: new Date().toISOString(),
  environment: 'local isolated synthetic ledger; AI disabled; not production capacity', store: health.stateStore,
  results, invariants: 'successful wallet writes and investments preserved exactly' }, null, 2) + '\n')
console.log('PASS: load audit monetary invariants and server recovery')
