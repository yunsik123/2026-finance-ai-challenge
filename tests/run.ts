// 통합 테스트 실행기.
// 서버를 SUPABASE_AUTH_DISABLED=1 로 직접 띄워서, 테스트가 실제 Supabase Auth에
// 계정을 만들지 않도록 보장한다. 이미 8787에 서버가 떠 있으면 그 서버를 그대로 쓴다.
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const base = 'http://localhost:8787'
const suites = ['smoke.ts', 'enhancements.ts', 'integration-new.ts', 'coupon-cancel.ts']

const healthy = async () => {
  try {
    const response = await fetch(`${base}/api/health`)
    return response.ok ? await response.json() as { authProvider?: string } : undefined
  } catch {
    return undefined
  }
}

const run = (file: string, env: NodeJS.ProcessEnv) => new Promise<void>((resolve, reject) => {
  const child = spawn('npx', ['tsx', path.join('tests', file)], { cwd: root, stdio: 'inherit', env })
  child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${file} 실패 (exit ${code})`))))
  child.on('error', reject)
})

let server: ChildProcess | undefined
const existing = await healthy()
if (existing) {
  if (existing.authProvider !== 'local-demo') {
    console.error('이미 떠 있는 8787 서버가 Supabase Auth 모드입니다. 테스트가 실제 Supabase에 계정을 만들 수 있어요.')
    console.error('그 서버를 끄고 `npm run test:integration` 을 다시 실행하세요.')
    process.exit(1)
  }
  console.log('기존 8787 서버(local-demo)를 사용합니다.')
} else {
  server = spawn('npx', ['tsx', 'server/index.ts'], {
    cwd: root,
    stdio: 'ignore',
    env: { ...process.env, SUPABASE_AUTH_DISABLED: '1' },
  })
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (await healthy()) break
    await new Promise((r) => setTimeout(r, 250))
  }
  if (!await healthy()) {
    server.kill()
    throw new Error('테스트 서버가 60초 안에 뜨지 않았습니다.')
  }
  console.log('테스트 서버 기동 (SUPABASE_AUTH_DISABLED=1)')
}

try {
  for (const suite of suites) await run(suite, { ...process.env, SUPABASE_AUTH_DISABLED: '1' })
} finally {
  server?.kill()
}
