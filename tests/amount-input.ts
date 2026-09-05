import assert from 'node:assert/strict'
import { normalizeAmount, parseAmountInput } from '../src/lib/amount.ts'

assert.deepEqual(parseAmountInput('3000'), { amount: 3000, text: '3,000' }, '3,000원을 직접 입력할 수 있어야 합니다.')
assert.deepEqual(parseAmountInput('3,000원'), { amount: 3000, text: '3,000' }, '콤마나 원 표시는 숫자만 남겨 처리해야 합니다.')
assert.deepEqual(parseAmountInput(''), { amount: 0, text: '' }, '편집 중에는 입력값을 완전히 비울 수 있어야 합니다.')
assert.equal(normalizeAmount(3999), 3000, '입력이 끝나면 1,000원 단위로 맞춰야 합니다.')

console.log('PASS: 투자 금액 직접 입력 및 1,000원 단위 정규화')
