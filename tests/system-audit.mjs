// Owns every server and temporary ledger it tests. The SQL URL is intentionally fixed to a disposable local DB.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import pg from 'pg'
import { randomUUID } from 'node:crypto'

const root = path.resolve(import.meta.dirname, '..')
const mode = process.argv.includes('--postgres') ? 'postgres' : 'file'
const port = mode === 'postgres' ? 8897 : 8896
const base = `http://127.0.0.1:${port}`
const database = `meoktu_audit_${randomUUID().replaceAll('-', '')}`
const adminUrl = 'postgresql://postgres:audit-local-only@127.0.0.1:15439/postgres?sslmode=disable'
const dbUrl = `postgresql://postgres:audit-local-only@127.0.0.1:15439/${database}?sslmode=disable`
let databaseCreated = false
const dir = await mkdtemp(path.join(tmpdir(), 'meoktu-system-audit-'))
const failures = []
const reports = []
const children = []
const run = (file, env) => new Promise((resolve, reject) => {
  const started = Date.now()
  let output = ''
  const child = spawn(process.execPath, ['--import', 'tsx', `tests/${file}`], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  const timeout = setTimeout(() => { child.kill(); reject(new Error(`${file}: timeout`)) }, 180000)
  child.once('error', reject)
  child.once('exit', code => {
    clearTimeout(timeout)
    reports.push({ suite: file, exitCode: code, elapsedMs: Date.now() - started, output })
    console.log(`${code === 0 ? 'PASS' : 'FAIL'}: ${file} (${Date.now() - started}ms)`)
    if (code !== 0) console.error(output.slice(-2500))
    resolve(code)
  })
})
try {
  assert(!(await fetch(base + '/api/health').then(() => true, () => false)), 'Audit port occupied')
  await readFile(path.join(root, 'dist/client/index.html'))
  if (mode === 'postgres') {
    const admin = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 5000 })
    await admin.connect()
    try { await admin.query(`CREATE DATABASE "${database}"`); databaseCreated = true }
    finally { await admin.end() }
    const client = new pg.Client({ connectionString: dbUrl, connectionTimeoutMillis: 5000, statement_timeout: 20000 })
    await client.connect()
    try {
      for (const file of ['cloudsql-compat.sql', 'schema.sql', 'policies.sql', 'functions.sql', 'import.sql', 'ledger.sql']) {
        await client.query(await readFile(path.join(root, 'db', file), 'utf8'))
      }
      client.on('notice', message => { if (/통과|실패|✗/.test(message.message)) console.log(message.message) })
      await client.query('BEGIN')
      try { await client.query(await readFile(path.join(root, 'db/rpc-test.sql'), 'utf8')) }
      finally { await client.query('ROLLBACK') }
      console.log('PASS: PostgreSQL schema and transactional RPC tests')
    } finally { await client.end() }
  }
  const env = { ...process.env, STATE_STORE: mode, DATABASE_URL: dbUrl, INSTANCE_CONNECTION_NAME: '',
    NEO4J_URI: '', AI_DISABLED: '1', SUPABASE_AUTH_DISABLED: '1', MEOKTU_DATA_DIR: dir,
    APP_SECRET: 'isolated-audit-secret', PORT: String(port), MEOKTU_TEST_BASE: base, MEOKTU_ISOLATED_AUDIT: '1' }
  let logs = ''
  const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(server)
  server.stdout.on('data', chunk => { logs = (logs + chunk).slice(-10000) })
  server.stderr.on('data', chunk => { logs = (logs + chunk).slice(-10000) })
  const deadline = Date.now() + 30000
  while (Date.now() < deadline && server.exitCode === null) {
    if (await fetch(base + '/api/health').then(r => r.ok, () => false)) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert(await fetch(base + '/api/health').then(r => r.ok, () => false), `Server failed: ${logs}`)
  console.log(`Isolated system audit: ${mode}`)
  if (mode === 'postgres') {
    const secondary = 'http://127.0.0.1:8898'
    assert(!(await fetch(secondary + '/api/health').then(() => true, () => false)), 'Secondary port occupied')
    const second = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      cwd: root, env: { ...env, PORT: '8898' }, stdio: ['ignore', 'pipe', 'pipe'] })
    children.push(second)
    second.stdout.on('data', () => {})
    second.stderr.on('data', chunk => { logs = (logs + chunk).slice(-10000) })
    const readyBy = Date.now() + 30000
    while (Date.now() < readyBy && second.exitCode === null) {
      if (await fetch(secondary + '/api/health').then(r => r.ok, () => false)) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert(await fetch(secondary + '/api/health').then(r => r.ok, () => false), 'Second instance failed')
    env.MEOKTU_SECONDARY_BASE = secondary
  }
  const suites = process.argv.includes('--load-only') ? ['load-audit.ts']
    : mode === 'postgres'
      ? ['smoke.ts', 'enhancements.ts', 'integration-new.ts', 'coupon-cancel.ts', 'coupon-exchange.ts', 'merged-modules.ts', 'demo-and-data.ts', 'admin-operations.ts', 'ai-and-ui-audit.ts', 'owner-verification.ts', 'ai-analysis.ts', 'runtime-audit.ts', 'load-audit.ts']
      : ['runtime-audit.ts', 'ai-eval.ts', 'investment-advice-policy.ts', 'load-audit.ts']
  for (const suite of suites) {
    if (await run(suite, env) !== 0) failures.push(suite)
  }
  if (failures.length) console.error('Failed suites:', failures.join(', '), '\nServer log tail:\n', logs.slice(-3000))
  await writeFile(`docs/audit-2026-09-07/suites-${mode}.json`, JSON.stringify({ at: new Date().toISOString(), mode, failures, reports }, null, 2) + '\n')
} finally {
  for (const child of children) {
    if (child.exitCode !== null) continue
    const exited = once(child, 'exit')
    child.kill('SIGTERM'); await exited
  }
  await rm(dir, { recursive: true, force: true })
  if (databaseCreated) {
    const admin = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 5000 })
    await admin.connect()
    try { await admin.query(`DROP DATABASE "${database}"`) }
    finally { await admin.end() }
  }
}
if (failures.length) process.exitCode = 1
