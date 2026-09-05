import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'

export const UNIT = 1000

const digitsOf = (value: string) => value.replace(/\D/g, '')
const format = (value: number) => value.toLocaleString('ko-KR')

/** 입력이 끝난 금액을 1,000원 단위로 맞추고 허용 범위 안으로 넣는다. */
export const normalizeAmount = (value: number, min = UNIT, max?: number) => {
  const floored = Math.floor((Number.isFinite(value) ? value : 0) / UNIT) * UNIT
  const capped = typeof max === 'number' ? Math.min(floored, Math.floor(max / UNIT) * UNIT) : floored
  return Math.max(min, capped)
}

/**
 * 금액 입력칸 상태.
 * 타이핑 중에 값을 1,000원 단위로 깎으면 방금 누른 자리가 사라져 엉뚱한 금액이 들어가므로,
 * 입력 중에는 숫자를 그대로 두고 포커스가 빠지거나 제출할 때만 단위를 맞춘다.
 */
export function useAmountInput(initial: number, options: { min?: number; max?: number } = {}) {
  const { min = UNIT, max } = options
  const inputRef = useRef<HTMLInputElement>(null)
  const caretRef = useRef<number | null>(null)
  const [amount, setAmountState] = useState(initial)
  const [text, setText] = useState(format(initial))

  // 콤마를 다시 찍으면 커서가 맨 뒤로 튀므로 같은 숫자 위치로 되돌린다.
  useEffect(() => {
    const input = inputRef.current
    if (caretRef.current === null || !input) return
    input.setSelectionRange(caretRef.current, caretRef.current)
    caretRef.current = null
  }, [text])

  const setAmount = (value: number) => {
    const next = normalizeAmount(value, min, max)
    setAmountState(next)
    setText(format(next))
  }

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target
    const caret = input.selectionStart ?? input.value.length
    const typedBefore = digitsOf(input.value.slice(0, caret)).length
    const digits = digitsOf(input.value).slice(0, 12)
    const next = digits ? format(Number(digits)) : ''
    let position = 0
    for (let index = 0, seen = 0; index < next.length && typedBefore > 0; index += 1) {
      if (/\d/.test(next[index])) seen += 1
      position = index + 1
      if (seen === typedBefore) break
    }
    caretRef.current = position
    setText(next)
    setAmountState(digits ? Number(digits) : 0)
  }

  /** blur·제출 직전에 호출해 화면과 서버로 나가는 값을 1,000원 단위로 맞춘다. */
  const commit = () => {
    const next = normalizeAmount(amount, min, max)
    setAmountState(next)
    setText(format(next))
    return next
  }

  return {
    amount,
    setAmount,
    commit,
    bind: {
      ref: inputRef,
      type: 'text' as const,
      inputMode: 'numeric' as const,
      autoComplete: 'off' as const,
      value: text,
      onChange,
      onBlur: commit,
    },
  }
}
