// 재방문율 복구 (1회성).
//
// repeat_rate 열 제약이 0~1 이던 시절, import 가 least(..., 1) 로 잘라 넣어서
// 모든 식당의 재방문율이 1 로 저장됐다. 제약은 0~100 으로 고쳤지만 이미 잘린
// 값은 되살아나지 않는다. 원래 퍼센트를 다시 넣는다.
//
//   출처 ① data/db.json 의 같은 id 식당 (시드로 만든 식당)
//   출처 ② applications.data 의 measuredMetrics.repeatRate (심사 승인으로 생긴 식당)
//
// 마지막에 ledger_meta.version 을 올린다. 그러지 않으면 돌고 있는 서버가
// "버전이 그대로면 다시 읽지 않는다"(ledger-context.ts) 규칙 때문에 낡은 1 을
// 그대로 들고 있다가 다음 저장에서 도로 덮어쓴다.
//
//   node --env-file=.env scripts/fix-repeat-rate.mjs --dry   무엇이 바뀔지만 본다
//   node --env-file=.env scripts/fix-repeat-rate.mjs         실제로 고친다
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dry = process.argv.includes('--dry')
const url = new URL(String(process.env.DATABASE_URL || '').trim())
url.searchParams.delete('sslmode')
const client = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } })
await client.connect()

const local = JSON.parse(fs.readFileSync(path.join(root, 'data', 'db.json'), 'utf8'))
const fromLedger = new Map(local.restaurants.map((item) => [item.id, item.repeatRate]))

const { rows } = await client.query(
  'select id, name, repeat_rate, source_application_id from meoktu.restaurants order by id')
const apps = new Map((await client.query('select id, data from meoktu.applications')).rows
  .map((item) => [item.id, item.data || {}]))

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : null)
const plan = []
for (const restaurant of rows) {
  const current = Number(restaurant.repeat_rate)
  let next = null
  let source = ''
  if (fromLedger.has(restaurant.id)) {
    next = num(fromLedger.get(restaurant.id))
    source = 'data/db.json'
  }
  if (next === null && restaurant.source_application_id) {
    const data = apps.get(restaurant.source_application_id) || {}
    const metrics = data.measuredMetrics || data.derivedMetrics || {}
    next = num(metrics.repeatRate)
    source = 'applications.data.measuredMetrics'
  }
  if (next === null) {
    plan.push({ id: restaurant.id, name: restaurant.name, current, next: null, source: '원본 없음' })
    continue
  }
  next = Math.min(Math.max(next, 0), 100)
  if (Math.abs(next - current) < 0.0001) continue
  plan.push({ id: restaurant.id, name: restaurant.name, current, next, source })
}

const changes = plan.filter((item) => item.next !== null)
console.log(`식당 ${rows.length}곳 · 고칠 대상 ${changes.length}곳\n`)
for (const item of plan) {
  console.log(item.next === null
    ? `  ?  ${item.name} (${item.id}) — 현재 ${item.current}, 원본을 찾지 못해 그대로 둠`
    : `  →  ${item.name} (${item.id}) — ${item.current} → ${item.next}  [${item.source}]`)
}

if (!changes.length) {
  console.log('\n바꿀 것이 없습니다.')
  await client.end()
  process.exit(0)
}
if (dry) {
  console.log('\n--dry 라서 아무것도 반영하지 않았습니다.')
  await client.end()
  process.exit(0)
}

await client.query('begin')
try {
  for (const item of changes) {
    await client.query('update meoktu.restaurants set repeat_rate = $2 where id = $1', [item.id, item.next])
  }
  // 돌고 있는 서버가 원장을 다시 읽게 만든다.
  const { rows: [meta] } = await client.query(
    "update meoktu.ledger_meta set version = version + 1, updated_at = now() where id = 'meoktu' returning version")
  await client.query('commit')
  console.log(`\n${changes.length}곳 반영 완료. 원장 버전 → ${meta.version} (서버가 다시 읽습니다).`)
} catch (error) {
  await client.query('rollback')
  console.error('\n실패해서 전부 되돌렸습니다:', error.message)
  process.exitCode = 1
} finally {
  await client.end()
}
