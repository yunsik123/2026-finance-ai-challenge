// 먹투 운영 스키마 적용기.
//
//   node scripts/apply-db.mjs --dry     스키마·정책·RPC 문법만 검증한다(rollback, 아무것도 안 남음)
//   node scripts/apply-db.mjs --test    위에 더해 거래 RPC 동작 테스트까지 돌린다(rollback)
//   node scripts/apply-db.mjs           실제로 적용한다(스키마 → 정책 → RPC → 이관 함수)
//   node scripts/apply-db.mjs --import  적용 후 app_state 원장을 정규화 테이블로 옮긴다
//
// SUPABASE_ACCESS_TOKEN(Management API 토큰)이 필요하며 브라우저에 절대 노출하지 않는다.
// 되돌리려면: drop schema meoktu cascade;  (public 의 기존 테이블은 건드리지 않는다)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnvFile } from 'node:process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
for (const name of ['.env.local', '.env.development.local', '.env']) {
  try { loadEnvFile(path.join(root, name)) } catch { /* 없으면 넘어간다 */ }
}

const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
const token = String(process.env.SUPABASE_ACCESS_TOKEN || '').trim()
const ref = process.env.SUPABASE_PROJECT_REF || url.replace(/^https:\/\//, '').split('.')[0]
if (!token || !ref) {
  console.error('SUPABASE_ACCESS_TOKEN 과 SUPABASE_URL(또는 SUPABASE_PROJECT_REF)이 필요합니다.')
  process.exit(1)
}

const read = (file) => fs.readFileSync(path.join(root, 'db', file), 'utf8')

async function runSql(label, sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${label} 실패 (${response.status})\n${text.slice(0, 900)}`)
  console.log(`✅ ${label}`)
  try { return JSON.parse(text) } catch { return [] }
}

const dry = process.argv.includes('--dry')
const test = process.argv.includes('--test')

if (dry || test) {
  // begin ... rollback 이라 검증만 하고 DB 에는 아무것도 남지 않는다.
  const parts = [read('schema.sql'), read('policies.sql'), read('functions.sql'), read('import.sql'), read('ledger.sql')]
  if (test) parts.push(read('rpc-test.sql'))
  await runSql(test ? '스키마·정책·RPC + 거래 동작 테스트 (rollback)' : '스키마·정책·RPC 문법 검증 (rollback)',
    `begin;\n${parts.join('\n')}\nrollback;`)
  console.log('\n아무것도 반영하지 않았습니다. 실제 적용은 옵션 없이 다시 실행하세요.')
  process.exit(0)
}

await runSql('스키마 meoktu', read('schema.sql'))
await runSql('행 수준 보안 정책', read('policies.sql'))
await runSql('거래 RPC', read('functions.sql'))
await runSql('원장 이관 함수', read('import.sql'))
await runSql('원장 입출력 함수', read('ledger.sql'))

// PostgREST 가 meoktu 스키마를 노출하도록 설정한다. 서버는 이 경로로 테이블을 읽고 쓴다.
await runSql('PostgREST 노출 스키마에 meoktu 추가', `
  alter role authenticator set pgrst.db_schemas = 'public, graphql_public, meoktu';
  notify pgrst, 'reload config';
  -- 함수를 새로 만들면 스키마 캐시를 갱신해야 REST 로 호출할 수 있다.
  notify pgrst, 'reload schema';
`)

if (process.argv.includes('--import')) {
  const rows = await runSql('app_state 원장 → 정규화 테이블 이관', `
    select meoktu.import_ledger((select data from public.app_state where id = 'meoktu')) as report;
  `)
  console.log('\n이관 결과:', JSON.stringify(rows?.[0]?.report ?? rows, null, 2))
}

console.log('\n완료. 되돌리려면: drop schema meoktu cascade;')
