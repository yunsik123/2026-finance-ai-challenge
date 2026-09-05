// 먹투 운영 스키마 적용기 (Cloud SQL PostgreSQL).
//
//   node scripts/apply-cloudsql.mjs --dry     문법만 검증한다(rollback, 아무것도 안 남음)
//   node scripts/apply-cloudsql.mjs --test    위에 더해 거래 RPC 동작 테스트까지 돌린다(rollback)
//   node scripts/apply-cloudsql.mjs           실제로 적용한다
//   node scripts/apply-cloudsql.mjs --seed    적용 후 data/db.json 원장을 테이블로 옮긴다
//
// DATABASE_URL 이 필요하다. Cloud SQL 공인 IP 로 붙으려면 내 IP 가 승인된 네트워크에 있어야 한다.
// 되돌리려면: drop schema meoktu cascade;
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnvFile } from 'node:process'
import pg from 'pg'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
for (const name of ['.env.local', '.env.development.local', '.env']) {
  try { loadEnvFile(path.join(root, name)) } catch { /* 없으면 넘어간다 */ }
}

const url = String(process.env.DATABASE_URL || '').trim()
if (!url) {
  console.error('DATABASE_URL 이 필요합니다. 예) postgresql://meoktu:<암호>@<공인IP>:5432/meoktu?sslmode=require')
  process.exit(1)
}

const read = (file) => fs.readFileSync(path.join(root, 'db', file), 'utf8')
// sslmode 를 URL 에 남기면 pg 가 엄격 검증으로 해석해 아래 ssl 옵션을 덮어쓴다.
// Cloud SQL 인증서는 사설 CA 발급이라 체인 검증이 실패하므로 직접 떼어내고 정한다.
const parsed = new URL(url)
const sslMode = parsed.searchParams.get('sslmode') ?? 'require'
parsed.searchParams.delete('sslmode')
const client = new pg.Client({
  connectionString: parsed.toString(),
  ssl: sslMode === 'disable' ? undefined : { rejectUnauthorized: false },
  statement_timeout: 120_000,
})
await client.connect()

async function runSql(label, sql) {
  try {
    const result = await client.query(sql)
    console.log(`✅ ${label}`)
    return result
  } catch (error) {
    console.error(`❌ ${label}`)
    console.error(`   ${error.message}`)
    if (error.position) console.error(`   위치: ${error.position}`)
    throw error
  }
}

const dry = process.argv.includes('--dry')
const test = process.argv.includes('--test')

// 파일 순서가 곧 의존 순서다. 호환 레이어가 가장 먼저 와야 auth.users 참조가 풀린다.
const files = ['cloudsql-compat.sql', 'schema.sql', 'policies.sql', 'functions.sql', 'import.sql', 'ledger.sql']

try {
  if (dry || test) {
    const parts = files.map(read)
    if (test) parts.push(read('rpc-test.sql'))
    await client.query('begin')
    try {
      await runSql(test ? '스키마·정책·RPC + 거래 동작 테스트 (rollback)' : '스키마·정책·RPC 문법 검증 (rollback)', parts.join('\n'))
    } finally {
      await client.query('rollback')
    }
    console.log('\n아무것도 반영하지 않았습니다. 실제 적용은 옵션 없이 다시 실행하세요.')
  } else {
    for (const file of files) await runSql(file, read(file))

    if (process.argv.includes('--seed')) {
      // 로컬 파일 원장을 그대로 올린다. 시연 데이터를 클라우드에서 다시 만들 필요가 없다.
      const ledgerPath = path.join(root, 'data', 'db.json')
      if (!fs.existsSync(ledgerPath)) {
        console.error(`\n${ledgerPath} 가 없어 이관을 건너뜁니다. 서버를 한 번 띄우면 만들어집니다.`)
      } else {
        const ledger = fs.readFileSync(ledgerPath, 'utf8')
        const { rows } = await runSql('data/db.json → 정규화 테이블 이관',
          { text: 'select meoktu.import_ledger($1::jsonb) as report', values: [ledger] })
        console.log('\n이관 결과:', JSON.stringify(rows?.[0]?.report ?? rows, null, 2))
      }
    }
    console.log('\n완료. 되돌리려면: drop schema meoktu cascade;')
  }
} finally {
  await client.end()
}
