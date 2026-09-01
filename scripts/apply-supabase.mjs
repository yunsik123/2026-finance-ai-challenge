// Supabase 스키마 적용 스크립트.
//   node scripts/apply-supabase.mjs           → 공유 원장 테이블(app_state)만 만든다
//   node scripts/apply-supabase.mjs --full    → db/postgres-schema.sql 까지 함께 적용한다
//
// SUPABASE_ACCESS_TOKEN(Management API 토큰)이 필요하며, 브라우저에는 절대 노출하지 않는다.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnvFile } from 'node:process'
import { APP_STATE_SQL } from '../server/store.ts'

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

async function runSql(label, sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${label} 실패 (${response.status}): ${text.slice(0, 400)}`)
  console.log(`✅ ${label}`)
}

await runSql('공유 원장 테이블 app_state', APP_STATE_SQL)

if (process.argv.includes('--full')) {
  const schema = fs.readFileSync(path.join(root, 'db', 'postgres-schema.sql'), 'utf8')
  await runSql('db/postgres-schema.sql', schema)
}

console.log(`\n프로젝트 ${ref} 적용 완료. 서버에 STATE_STORE=supabase 와 SUPABASE_SERVICE_ROLE_KEY 를 설정하면 공유 원장을 사용합니다.`)
