import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FocusEvent } from 'react'

export const UNIT = 1000

const digitsOf = (value: string) => value.replace(/\D/g, '')
const format = (value: number) => value.toLocaleString('ko-KR')

/** 사용자가 붙여넣거나 직접 입력한 문자열에서 금액과 표시값을 만든다. */
export const parseAmountInput = (value: string) => {
  const digits = digitsOf(value).slice(0, 12)
  return {
    amount: digits ? Number(digits) : 0,
    text: digits ? format(Number(digits)) : '',
  }
}

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
    const nextValue = parseAmountInput(input.value)
    const next = nextValue.text
    let position = 0
    for (let index = 0, seen = 0; index < next.length && typedBefore > 0; index += 1) {
      if (/\d/.test(next[index])) seen += 1
      position = index + 1
      if (seen === typedBefore) break
    }
    caretRef.current = position
    setText(next)
    setAmountState(nextValue.amount)
  }

  // 첫 클릭에서는 기존 금액을 모두 선택해 1,000 → 3,000처럼 바로 덮어쓸 수 있게 한다.
  // 두 번째 클릭부터는 포커스 이벤트가 다시 발생하지 않아 원하는 자리만 고칠 수도 있다.
  const onFocus = (event: FocusEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const selectCurrentAmount = () => {
      if (inputRef.current === input && document.activeElement === input) input.select()
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(selectCurrentAmount)
    else selectCurrentAmount()
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
      onFocus,
      onBlur: commit,
    },
  }
}
