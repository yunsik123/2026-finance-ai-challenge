/**
 * 거래 RPC 경로의 불변조건 검사.
 *
 * runLedgerRpc 는 RPC 가 테이블을 직접 바꾼 뒤 메모리 원장을 다시 읽는다.
 * 그 경로에서 saveDatabase() 를 부르면 낡은 메모리 전체를 다시 써서
 * RPC 가 바꾼 내용을 지울 수 있고, 버전 충돌 재시도 경로에서는
 * 그 사이 다른 인스턴스가 쓴 내용까지 덮어쓴다.
 *
 * 실수하기 쉬운 자리라 소스에서 직접 막는다. 실제로 회수 라우트 한 곳이
 * 이 규칙을 어긴 채 들어왔고, 리뷰에서 잡혔다.
 */
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../server/index.ts', import.meta.url), 'utf8')

/**
 * 주석만 제거한다. 주석에 적힌 함수 이름까지 잡으면 설명을 쓸 수 없기 때문이다.
 *
 * 문자열까지 지우려다 한 번 크게 틀렸다. 작은따옴표 정규식이 줄바꿈을 넘어
 * 매칭되면서 코드 전체를 공백으로 만들어 버렸고, 검사는 아무것도 못 찾은 채
 * 통과했다. 위반을 일부러 심어 실패하는지 확인해서(음성 대조) 알아냈다.
 * 문자열 안에 'saveDatabase(' 가 들어 있을 일은 없으므로 그냥 두는 편이 안전하다.
 */
function stripComments(text: string) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (match) => ' '.repeat(match.length))
}

const clean = stripComments(source)
// 검사 자체가 무력화되지 않았는지 먼저 본다. 블록을 하나도 못 찾으면 그게 버그다.
const blockCount = clean.split('\n').filter((line) => line.includes('if (ledgerRpcEnabled)')).length
if (blockCount === 0) throw new Error('ledgerRpcEnabled 블록을 하나도 찾지 못했습니다. 검사가 깨졌습니다.')
const lines = clean.split('\n')
const violations: string[] = []

lines.forEach((line, index) => {
  if (!line.includes('if (ledgerRpcEnabled)')) return
  let depth = 0
  let opened = false
  for (let cursor = index; cursor < lines.length; cursor += 1) {
    for (const character of lines[cursor]) {
      if (character === '{') { depth += 1; opened = true }
      else if (character === '}') depth -= 1
    }
    if (opened && depth <= 0) {
      const block = lines.slice(index, cursor + 1).join('\n')
      if (block.includes('saveDatabase(')) {
        violations.push(`server/index.ts:${index + 1}-${cursor + 1} 의 RPC 블록이 saveDatabase() 를 호출합니다.`)
      }
      return
    }
  }
})

// 반대 방향도 본다. RPC 를 부르고 원장을 다시 읽지 않으면 메모리가 낡은 채로 남는다.
if (!/const snapshot = await store\.read\(\)/.test(source.split('async function runLedgerRpc')[1]?.slice(0, 600) || '')) {
  violations.push('runLedgerRpc 가 RPC 호출 뒤 원장을 다시 읽지 않습니다.')
}

if (violations.length) {
  for (const item of violations) console.error(`  ✗ ${item}`)
  throw new Error(`거래 RPC 불변조건 위반 ${violations.length}건`)
}

console.log(`PASS: 거래 RPC 블록 ${blockCount}곳에서 saveDatabase() 미사용 | RPC 후 원장 재조회 확인`)
