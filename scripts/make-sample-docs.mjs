/**
 * 모의 심사 서류(PNG · PDF) 자동 생성기.
 *
 *   node scripts/make-sample-docs.mjs
 *
 * 승재 프로젝트에는 reportlab으로 사업자등록증·영업신고증·임대차계약서·
 * 부가세 과세표준증명원을 폰트·표·워터마크까지 찍어내는 파이썬 스크립트가 있었다
 * (generate_jaeyongtaco_demo_docs.py / generate_yunsikramen_demo_docs.py).
 * 먹투는 파이썬 런타임을 쓰지 않으므로 같은 결과를 다른 방법으로 만든다.
 * scripts/sample-docs/*.html 을 크롬 헤드리스로 PNG와 PDF로 동시에 렌더한다.
 *
 * 그동안 이 렌더링은 사람이 손으로 돌려야 했고 PDF는 아예 없었다.
 * 사장님 센터의 업로드 카드가 PDF도 받으므로 두 형식을 함께 낸다.
 *
 * 문서에는 항상 '실제 제출 불가' 배너와 워터마크가 들어간다.
 * 실제 서류처럼 쓰일 수 있는 파일을 만들지 않기 위한 안전장치이며 지우면 안 된다.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import { rebuildSamplePack } from './zip-samples.mjs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const templates = path.join(root, 'scripts', 'sample-docs')
const out = path.join(root, 'public', 'samples')

/** 템플릿 → 배포 파일 이름. 사장님 센터 uploadOptions 의 sampleUrl 과 맞춰야 한다. */
const DOCUMENTS = [
  // _style.css 가 body 를 1024x1448 로 고정해 두었다. 창 크기를 그 값에 맞춰야 잘리지 않는다.
  { template: 'business.html', name: 'meoktu-business-sample', title: '사업자등록 증빙' },
  { template: 'license.html', name: 'meoktu-license-sample', title: '영업신고 증빙' },
  { template: 'tax.html', name: 'meoktu-tax-sample', title: '부가가치세 과세표준 증빙' },
  { template: 'lease.html', name: 'meoktu-lease-sample', title: '임대차 조건' },
]

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean)

async function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    try { await fs.access(candidate); return candidate } catch { /* 다음 후보 */ }
  }
  return undefined
}

/**
 * 크롬 헤드리스로 파일 하나를 렌더한다.
 *
 * headless=new 는 렌더가 끝나도 프로세스를 붙잡고 있는 경우가 있다.
 * 그래서 종료를 기다리지 않고 "결과 파일이 나왔는가"를 기준으로 판단한 뒤
 * 남아 있는 프로세스를 정리한다.
 */
async function render(bin, args, target) {
  await fs.rm(target, { force: true })
  const child = spawn(bin, args, { stdio: 'ignore' })
  const finished = new Promise((resolve) => child.on('exit', resolve).on('error', resolve))
  const deadline = Date.now() + 30_000
  let produced = false
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 400))
    try {
      const stat = await fs.stat(target)
      // 크기가 두 번 연속 같으면 쓰기가 끝난 것으로 본다.
      if (stat.size > 0) {
        await new Promise((resolve) => setTimeout(resolve, 400))
        const again = await fs.stat(target)
        if (again.size === stat.size) { produced = true; break }
      }
    } catch { /* 아직 안 나왔다 */ }
    if (child.exitCode !== null) break
  }
  child.kill('SIGKILL')
  await finished
  if (!produced) throw new Error(`렌더 결과가 나오지 않았습니다: ${path.basename(target)}`)
}

const chrome = await findChrome()
if (!chrome) {
  console.error('크롬을 찾지 못했습니다. CHROME_PATH 환경변수로 실행 파일 경로를 지정해주세요.')
  console.error('예: CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node scripts/make-sample-docs.mjs')
  process.exit(1)
}

await fs.mkdir(out, { recursive: true })
// 크롬은 프로필 디렉터리를 쓰기 때문에 임시 디렉터리를 따로 준다.
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'meoktu-docs-'))
const common = ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--virtual-time-budget=3000', `--user-data-dir=${profile}`]

console.log(`모의 심사 서류를 생성합니다 (크롬: ${path.basename(chrome)})`)
for (const document of DOCUMENTS) {
  const source = `file://${path.join(templates, document.template)}`
  const png = path.join(out, `${document.name}.png`)
  const pdf = path.join(out, `${document.name}.pdf`)
  await render(chrome, [...common, '--window-size=1024,1448', `--screenshot=${png}`, source], png)
  await render(chrome, [...common, '--no-pdf-header-footer', `--print-to-pdf=${pdf}`, source], pdf)
  console.log(`  ✓ ${document.title} — ${path.basename(png)} / ${path.basename(pdf)}`)
}
await fs.rm(profile, { recursive: true, force: true })

console.log('\n완료. 모든 문서에 “실제 제출 불가” 배너와 워터마크가 들어 있습니다.')
console.log('CSV 자료는 node scripts/make-sample-data.mjs 로 따로 생성합니다.')

await rebuildSamplePack(out)
