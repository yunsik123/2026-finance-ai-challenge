import { loadEnvFile } from 'node:process'
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import path from 'node:path'
const root = path.resolve(import.meta.dirname, '../..')
const snapshot = '/private/tmp/meoktu-release-audit-pBztRd'
loadEnvFile(path.join(root, '.env'))
const env = { ...process.env, STATE_STORE: 'file', NEO4J_URI: '', NEO4J_PASSWORD: '',
  DATABASE_URL: '', INSTANCE_CONNECTION_NAME: '', DB_PASSWORD: '',
  SUPABASE_AUTH_DISABLED: '1', AI_DISABLED: '0', PORT: '18973',
  APP_SECRET: 'release-audit-local-synthetic-only', MEOKTU_DATA_DIR: path.join(snapshot, 'audit-data') }
const log = createWriteStream(path.join(import.meta.dirname, 'isolated-server.log'), {flags:'a'})
const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {cwd:snapshot, env, stdio:['ignore','pipe','pipe']})
child.stdout.pipe(log); child.stderr.pipe(log)
console.log('Isolated server PID',child.pid,'port 18973; file ledger; production DB and graph disabled; Vertex enabled')
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>child.kill('SIGTERM'))
child.on('exit',code=>{ log.end(); process.exitCode=code||0 })
