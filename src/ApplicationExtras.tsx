/**
 * 신청서에서 사장님이 화면으로 직접 적는 자료들.
 *
 * Honeycomb Credit 이 정식으로 받는 축 중 먹투에 없던 것들이다.
 *   · 자금 사용계획 — 무엇에 얼마를 쓸 것인가
 *   · 부채현황(debt schedule) — 대출 없음 한 번 클릭, 있으면 잔액·금리·상환액·만기
 *   · 소유구조(ownership breakdown) — 지분 20% 이상 보유자
 * 서류를 요구하지 않는다. 20페이지 사업계획서를 요구하면 아무도 못 낸다.
 *
 * 그리고 발급 안내. "사업자등록증명 어디서 받아요?"에서 막히는 사장님이 가장 많다.
 * 요건·발급창구는 서버(server/issuance.ts)에서 내려받아 화면과 AI 상담이 같은 값을 쓴다.
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Banknote, Building2, CircleHelp, ExternalLink, Landmark, Plus, Store, Trash2, TriangleAlert, Users, X,
} from 'lucide-react'
import type { DeclaredDebt, DeclaredLoan, DocumentGuide, DocumentRequirement, FundUseItem, OwnershipRow, Restaurant } from './types.ts'

const won = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`
const manwon = (value: number) => `${Math.round(value / 10000).toLocaleString('ko-KR')}만원`

/* ── 요건 배지 ─────────────────────────────────────────────── */

const requirementTone: Record<DocumentRequirement, string> = {
  required: 'req-must',
  'sales-one-of': 'req-oneof',
  conditional: 'req-cond',
  optional: 'req-option',
}

/** 자료 옆에 붙는 필수/택1/조건부/선택 표시. 색과 말을 함께 쓴다(색만으로 구분하지 않는다). */
export function RequirementBadge({ requirement, label }: { requirement: DocumentRequirement; label: string }) {
  return <span className={`requirement-badge ${requirementTone[requirement]}`}>{label}</span>
}

/* ── 발급 안내 도움말 ──────────────────────────────────────── */

/**
 * "어디서 어떻게 받나요?" 도움말.
 *
 * 예전에는 자료 카드 안에서 말풍선으로 열었다. 그런데 카드에 hover transform 이 걸려 있어
 * 카드가 쌓임 맥락(stacking context)을 만들고, 말풍선의 z-index 가 그 안에 갇혀
 * 뒤에 오는 카드에 가려졌다. 카드 폭 밖으로 나가는 부분이 잘리기도 했다.
 *
 * 그래서 body 로 옮겨 화면 가운데 창으로 띄운다. 어떤 부모에도 갇히지 않으므로
 * 겹침·잘림이 구조적으로 생기지 않는다. Esc·바깥 클릭·닫기 버튼으로 닫는다.
 */
export function IssuanceHelp({ guide }: { guide: DocumentGuide }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    // 창이 떠 있는 동안 뒤 화면이 같이 스크롤되면 어느 카드의 안내인지 잃어버린다.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  return <div className="issuance-help">
    <button type="button" className="issuance-trigger" onClick={() => setOpen(true)} aria-expanded={open}>
      <CircleHelp /> 어디서 받나요?
    </button>
    {open && createPortal(
      <div className="issuance-backdrop" onMouseDown={() => setOpen(false)}>
        <div
          className="issuance-dialog" role="dialog" aria-modal="true"
          aria-label={`${guide.title} 발급 안내`}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <header>
            <div><b>{guide.title}</b><small>{guide.exact}</small></div>
            <button type="button" onClick={() => setOpen(false)} aria-label="닫기"><X /></button>
          </header>
          <p className="issuance-why">{guide.whyItMatters}</p>
          <ol>
            {guide.issuance.map((item) => <li key={item.channel}>
              <b>{item.channel}</b>
              <p>{item.how}</p>
              {item.url && <a href={item.url} target="_blank" rel="noreferrer noopener">{item.url.replace(/^https?:\/\//, '')} <ExternalLink /></a>}
              {item.note && <em>{item.note}</em>}
            </li>)}
          </ol>
          <small className="issuance-foot">기관 화면과 메뉴 이름은 바뀔 수 있어요. 못 찾으면 1:1 문의로 알려주시면 같이 찾아드립니다.</small>
        </div>
      </div>,
      document.body,
    )}
  </div>
}

/* ── 매출 확인 자료 진행 표시 ──────────────────────────────── */

/** 매출 자료는 택1이라서, 몇 개 중 하나라도 있으면 통과했다는 것을 분명히 보여준다. */
export function SalesEvidenceStatus({ satisfied, options }: { satisfied: string[]; options: Array<{ id: string; title: string }> }) {
  const ok = satisfied.length > 0
  return <div className={`sales-evidence-status ${ok ? 'ok' : ''}`}>
    <span>{ok ? '✅' : '②'}</span>
    <div>
      <b>{ok
        ? `매출 확인 자료 ${satisfied.length}종을 받았어요. 이 묶음은 통과입니다.`
        : '매출을 확인할 수 있는 자료가 하나는 필요해요'}</b>
      <p>
        {options.map((option) => option.title).join(' · ')} 중 <b>편한 것 하나만</b> 올리면 됩니다.
        {ok ? ' 더 올리면 산정되는 평가 지표가 늘어나요.' : ' POS가 없어도 카드 매출자료나 홈택스 자료로 신청할 수 있어요.'}
      </p>
    </div>
  </div>
}

/* ── 자금 사용계획 ─────────────────────────────────────────── */

export const FUND_USE_CATEGORIES = ['주방설비', '인테리어', '집기·비품', '운전자금', '재료·매입', '마케팅', '부채상환', '인건비', '기타']

/**
 * 자금 사용계획.
 *
 * "매출이 좋은 식당"만으로는 투자 판단이 안 된다. 받은 돈으로 무엇을 하고 그게
 * 앞으로의 현금흐름에 어떤 영향을 주는지가 핵심이라, 항목과 금액을 나눠 받는다.
 * 합계를 희망 펀딩액과 맞추게 해서 "3,000만원 필요한데 계획은 1,000만원"을 막는다.
 */
export function FundUsePlanEditor({ items, requestedLimit, onChange }: {
  items: FundUseItem[]
  requestedLimit: number
  onChange: (next: FundUseItem[]) => void
}) {
  const total = items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0)
  const gap = requestedLimit - total
  const update = (index: number, patch: Partial<FundUseItem>) =>
    onChange(items.map((item, current) => (current === index ? { ...item, ...patch } : item)))

  return <div className="fund-use-editor">
    <div className="fund-use-head">
      <div>
        <b>투자금을 어디에 쓸 계획인가요? <RequirementBadge requirement="required" label="필수" /></b>
        <p>항목과 금액으로 나눠 적어주세요. 투자자에게 그대로 공개되는 내용이라 구체적일수록 좋아요.</p>
      </div>
      <div className={`fund-use-total ${gap === 0 ? 'match' : ''}`}>
        <span>합계</span>
        <b>{won(total)}</b>
        <small>{gap === 0
          ? '희망 펀딩액과 일치'
          : gap > 0 ? `${won(gap)} 더 배분해야 해요` : `${won(-gap)} 초과했어요`}</small>
      </div>
    </div>

    <div className="fund-use-rows">
      {items.map((item, index) => <div className="fund-use-row" key={index}>
        <select value={item.category} onChange={(event) => update(index, { category: event.target.value })} aria-label="사용 항목">
          {FUND_USE_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
        </select>
        <div className="number-field">
          <input
            type="number" min={0} step={100000} value={item.amount || ''}
            onChange={(event) => update(index, { amount: Number(event.target.value) || 0 })}
            placeholder="금액" aria-label="금액"
          />
          <span>원</span>
        </div>
        <input
          value={item.note || ''} onChange={(event) => update(index, { note: event.target.value })}
          placeholder="예: 저온 저장고 1대 교체" aria-label="설명"
        />
        <button type="button" onClick={() => onChange(items.filter((_, current) => current !== index))} aria-label="항목 삭제"><Trash2 /></button>
      </div>)}
    </div>

    <div className="fund-use-actions">
      <button type="button" onClick={() => onChange([...items, { category: '운전자금', amount: 0, note: '' }])}>
        <Plus /> 항목 추가
      </button>
      {gap !== 0 && items.length > 0 && <button
        type="button" className="fund-use-fill"
        onClick={() => onChange(items.map((item, index) => (index === items.length - 1
          ? { ...item, amount: Math.max(0, (Number(item.amount) || 0) + gap) } : item)))}
      >남은 {won(Math.abs(gap))}을 마지막 항목에 넣기</button>}
    </div>
    {items.length > 0 && <div className="fund-use-bars">
      {items.filter((item) => item.amount > 0).map((item, index) => <div key={index} style={{ width: `${Math.min(100, (item.amount / Math.max(1, total)) * 100)}%` }}>
        <span>{item.category} {manwon(item.amount)}</span>
      </div>)}
    </div>}
  </div>
}

/* ── 부채현황 ──────────────────────────────────────────────── */

const emptyLoan = (): DeclaredLoan => ({ lender: '', balance: 0, rate: 0, monthlyPayment: 0, maturity: '' })

/**
 * 부채현황.
 *
 * 대출이 없으면 클릭 한 번으로 끝난다. 있으면 잔액·금리·월 상환액·만기를 받는다.
 * 여기서 적은 값은 예비평가 점수에 넣지 않는다(아직 검증되지 않은 자기신고값이라서).
 * 대신 부채 증빙을 함께 올리면 신고값과 자료가 맞는지 대조해 자료 일치도에 반영한다.
 */
export function DebtDeclaration({ value, onChange }: { value: DeclaredDebt; onChange: (next: DeclaredDebt) => void }) {
  const loans = value.loans || []
  const totalBalance = loans.reduce((sum, item) => sum + (Number(item.balance) || 0), 0)
  const totalPayment = loans.reduce((sum, item) => sum + (Number(item.monthlyPayment) || 0), 0)
  const update = (index: number, patch: Partial<DeclaredLoan>) =>
    onChange({ ...value, loans: loans.map((item, current) => (current === index ? { ...item, ...patch } : item)) })

  return <div className="debt-declaration">
    <div className="debt-head">
      <div>
        <b><Banknote /> 지금 대출이 있으신가요? <RequirementBadge requirement="conditional" label="대출 있으면 필수" /></b>
        <p>투자금을 갚아나갈 여력을 함께 봐야 투자자에게 설명할 수 있어요. 증빙은 없어도 되고, 올리면 적어주신 값과 맞는지 대조해드려요.</p>
      </div>
    </div>
    <div className="debt-choice">
      <button
        type="button" className={value.answered && !value.hasDebt ? 'active' : ''}
        onClick={() => onChange({ hasDebt: false, loans: [], answered: true })}
      >대출 없어요</button>
      <button
        type="button" className={value.hasDebt ? 'active' : ''}
        onClick={() => onChange({ hasDebt: true, answered: true, loans: loans.length ? loans : [emptyLoan()] })}
      >대출 있어요</button>
    </div>

    {value.hasDebt && <>
      <div className="debt-rows">
        {loans.map((loan, index) => <div className="debt-row" key={index}>
          <input value={loan.lender} onChange={(event) => update(index, { lender: event.target.value })} placeholder="금융기관 (예: ○○은행)" aria-label="금융기관" />
          <div className="number-field"><input type="number" min={0} step={100000} value={loan.balance || ''} onChange={(event) => update(index, { balance: Number(event.target.value) || 0 })} placeholder="잔액" aria-label="대출잔액" /><span>원</span></div>
          <div className="number-field"><input type="number" min={0} max={30} step={0.1} value={loan.rate || ''} onChange={(event) => update(index, { rate: Number(event.target.value) || 0 })} placeholder="금리" aria-label="금리" /><span>%</span></div>
          <div className="number-field"><input type="number" min={0} step={10000} value={loan.monthlyPayment || ''} onChange={(event) => update(index, { monthlyPayment: Number(event.target.value) || 0 })} placeholder="월 상환액" aria-label="월 상환액" /><span>원</span></div>
          <input value={loan.maturity} onChange={(event) => update(index, { maturity: event.target.value })} placeholder="만기 (예: 2028-06)" aria-label="만기" />
          <button type="button" onClick={() => onChange({ ...value, loans: loans.filter((_, current) => current !== index) })} aria-label="대출 삭제"><Trash2 /></button>
        </div>)}
      </div>
      <div className="debt-actions">
        <button type="button" onClick={() => onChange({ ...value, loans: [...loans, emptyLoan()] })}><Plus /> 대출 추가</button>
        <span className="debt-sum">총 잔액 <b>{won(totalBalance)}</b> · 월 상환 <b>{won(totalPayment)}</b></span>
      </div>
      <p className="debt-note">
        적어주신 값은 예비평가 점수에 바로 반영하지 않아요. 아직 확인되지 않은 신고값이기 때문이에요.
        부채 증빙이나 대출 내역 자료를 함께 올리시면 이 값과 자료가 맞는지 대조해 자료 일치도에 반영합니다.
      </p>
    </>}
    {value.answered && !value.hasDebt && <p className="debt-note">
      대출 없음으로 확인했어요. 나중에 자료에서 대출이 확인되면 운영자가 다시 확인할 수 있어요.
    </p>}
  </div>
}

/* ── 소유구조 ──────────────────────────────────────────────── */

/**
 * 소유구조.
 *
 * 공동사업자가 있는 가게에서 "누가 실제로 이 사업의 주인인가"는 투자 판단에 필요한 정보다.
 * 지분 20% 이상은 주요 소유자로 표시한다(Honeycomb 이 신용조회·배경조사 대상으로 삼는 기준).
 * 이 값도 점수에는 넣지 않고 운영자 확인용으로 저장한다.
 */
export function OwnershipEditor({ rows, ownerName, onChange }: {
  rows: OwnershipRow[]
  ownerName: string
  onChange: (next: OwnershipRow[]) => void
}) {
  const total = rows.reduce((sum, row) => sum + (Number(row.share) || 0), 0)
  const update = (index: number, patch: Partial<OwnershipRow>) =>
    onChange(rows.map((row, current) => (current === index ? { ...row, ...patch } : row)))

  return <div className="ownership-editor">
    <div className="ownership-head">
      <div>
        <b><Users /> 소유구조 <RequirementBadge requirement="optional" label="선택 · 공동사업자 있으면 권장" /></b>
        <p>혼자 운영하시면 비워두셔도 됩니다. 공동사업자가 있으면 지분을 적어주세요.</p>
      </div>
      <div className={`ownership-total ${total === 100 || total === 0 ? 'match' : ''}`}>
        <span>지분 합계</span><b>{total}%</b>
      </div>
    </div>
    {rows.length === 0 && <button
      type="button" className="ownership-solo"
      onClick={() => onChange([{ name: ownerName || '대표자', share: 100, role: '대표자' }])}
    >혼자 100% 운영이에요</button>}
    {rows.map((row, index) => <div className="ownership-row" key={index}>
      <input value={row.name} onChange={(event) => update(index, { name: event.target.value })} placeholder="이름" aria-label="이름" />
      <div className="number-field"><input type="number" min={0} max={100} value={row.share || ''} onChange={(event) => update(index, { share: Number(event.target.value) || 0 })} placeholder="지분" aria-label="지분" /><span>%</span></div>
      <input value={row.role} onChange={(event) => update(index, { role: event.target.value })} placeholder="역할 (예: 대표자, 주방총괄)" aria-label="역할" />
      {row.share >= 20 && <em className="ownership-major">주요 소유자</em>}
      <button type="button" onClick={() => onChange(rows.filter((_, current) => current !== index))} aria-label="삭제"><Trash2 /></button>
    </div>)}
    <div className="ownership-actions">
      <button type="button" onClick={() => onChange([...rows, { name: '', share: 0, role: '' }])}><Plus /> 사업자 추가</button>
      {total > 100 && <span className="ownership-warn"><TriangleAlert /> 합계가 100%를 넘어요</span>}
    </div>
  </div>
}

/* ── 신청 대상 고르기 ──────────────────────────────────────── */

/**
 * 새 가게인가, 이미 있는 가게의 다음 회차인가.
 *
 * 사장님이 2호점을 내거나 같은 가게로 다음 라운드를 받는 일이 실제로 생긴다.
 * 이걸 처음에 고르게 하면 상호명 오타로 별개 가게가 되는 일을 막고,
 * 마이페이지에서 신청을 가게별로 묶어 보여줄 수 있다.
 */
export function TargetPicker({ restaurants, value, onChange }: {
  restaurants: Restaurant[]
  value: string
  onChange: (restaurantId: string) => void
}) {
  if (!restaurants.length) return null
  return <div className="target-picker">
    <div className="target-head">
      <b><Store /> 어느 가게로 신청하시나요?</b>
      <p>이미 등록된 가게로 다음 회차를 받거나, 새 가게를 등록할 수 있어요. 고른 가게 기준으로 회차가 매겨집니다.</p>
    </div>
    <div className="target-options">
      {restaurants.map((restaurant) => <button
        type="button" key={restaurant.id}
        className={value === restaurant.id ? 'active' : ''}
        onClick={() => onChange(restaurant.id)}
      >
        <span>{restaurant.emoji || '🍽️'}</span>
        <div><b>{restaurant.name}</b><small>{restaurant.region} {restaurant.neighborhood} · {restaurant.category}</small><em>이 가게의 다음 회차</em></div>
      </button>)}
      <button type="button" className={value === '' ? 'active' : ''} onClick={() => onChange('')}>
        <span><Building2 /></span>
        <div><b>새 가게 등록</b><small>다른 매장으로 새로 신청해요</small><em>1회차로 시작</em></div>
      </button>
    </div>
  </div>
}

/* ── 결과·마이페이지에서 다시 보여주기 ─────────────────────── */

/** 접수된 신청의 자금 계획·부채·소유구조를 읽기 전용으로 보여준다. */
export function ApplicationExtrasSummary({ fundUsePlan, declaredDebt, ownership, salesBasis }: {
  fundUsePlan?: FundUseItem[]
  declaredDebt?: DeclaredDebt
  ownership?: OwnershipRow[]
  salesBasis?: string | null
}) {
  const hasAny = (fundUsePlan?.length || 0) > 0 || Boolean(declaredDebt) || (ownership?.length || 0) > 0
  if (!hasAny) return null
  const planTotal = (fundUsePlan || []).reduce((sum, item) => sum + item.amount, 0)
  return <div className="extras-summary">
    {fundUsePlan && fundUsePlan.length > 0 && <section>
      <h4><Landmark /> 자금 사용계획 <small>합계 {won(planTotal)}</small></h4>
      <ul>{fundUsePlan.map((item, index) => <li key={index}>
        <b>{item.category}</b><span>{won(item.amount)}</span>{item.note && <small>{item.note}</small>}
      </li>)}</ul>
    </section>}
    {declaredDebt && <section>
      <h4><Banknote /> 부채현황</h4>
      {declaredDebt.hasDebt
        ? <ul>{(declaredDebt.loans || []).map((loan, index) => <li key={index}>
          <b>{loan.lender || '금융기관 미기재'}</b>
          <span>잔액 {won(loan.balance)}</span>
          <small>금리 {loan.rate}% · 월 상환 {won(loan.monthlyPayment)}{loan.maturity ? ` · 만기 ${loan.maturity}` : ''}</small>
        </li>)}</ul>
        : <p className="extras-empty">대출 없음으로 신고했어요.</p>}
      <small className="extras-note">사장님 신고값이며 예비평가 점수에는 반영하지 않습니다. 증빙과의 대조 결과는 자료 일치도에서 확인하세요.</small>
    </section>}
    {ownership && ownership.length > 0 && <section>
      <h4><Users /> 소유구조</h4>
      <ul>{ownership.map((row, index) => <li key={index}>
        <b>{row.name}</b><span>{row.share}%</span><small>{row.role}{row.share >= 20 ? ' · 주요 소유자' : ''}</small>
      </li>)}</ul>
    </section>}
    {salesBasis && <p className="extras-basis">매출 기준 자료: <b>{salesBasis}</b></p>}
  </div>
}
