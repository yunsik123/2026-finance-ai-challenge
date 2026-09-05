import { useEffect, useState } from 'react'
import { useParams, NavLink, useNavigate } from 'react-router-dom'
import { BadgeCheck, ChevronLeft, ChevronRight, FileText, ScrollText, ShieldAlert, X } from 'lucide-react'
import { api } from './lib/api.ts'
import type { LegalConsentRecord, LegalDocument, LegalIndex, MeState } from './types.ts'
import './legal.css'

const contextLabel: Record<string, string> = {
  signup: '회원가입',
  invest: '투자',
  withdraw: '회수',
  owner_application: '펀딩 신청',
}

const won = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`
const at = (iso: string) => new Date(iso).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })

/** 목록과 본문은 여러 화면에서 쓰이므로 한 번 받아 캐시해 둔다. */
let indexCache: LegalIndex | undefined
const documentCache = new Map<string, LegalDocument>()

export async function loadLegalIndex() {
  indexCache ??= await api<LegalIndex>('/api/legal')
  return indexCache
}

export async function loadLegalDocument(documentId: string) {
  const cached = documentCache.get(documentId)
  if (cached) return cached
  const result = await api<{ document: LegalDocument }>(`/api/legal/${documentId}`)
  documentCache.set(documentId, result.document)
  return result.document
}

export function useLegalIndex() {
  const [index, setIndex] = useState<LegalIndex | undefined>(indexCache)
  useEffect(() => {
    let live = true
    loadLegalIndex().then((result) => { if (live) setIndex(result) }).catch(() => undefined)
    return () => { live = false }
  }, [])
  return index
}

function DocumentBody({ document }: { document: LegalDocument }) {
  return <article className="legal-body">
    {document.sections.map((section) => <section key={section.heading}>
      <h3>{section.heading}</h3>
      {section.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
    </section>)}
  </article>
}

/** 동의 체크박스 옆 "보기"에서 띄우는 읽기 전용 창. */
export function LegalDocModal({ documentId, onClose }: { documentId: string; onClose: () => void }) {
  const [document, setDocument] = useState<LegalDocument | undefined>(documentCache.get(documentId))
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    loadLegalDocument(documentId)
      .then((result) => { if (live) setDocument(result) })
      .catch((cause) => { if (live) setError((cause as Error).message) })
    return () => { live = false }
  }, [documentId])
  return <div className="modal-backdrop legal-backdrop" onMouseDown={onClose}>
    <div className="legal-modal" onMouseDown={(event) => event.stopPropagation()}>
      <button className="modal-close" onClick={onClose} aria-label="닫기"><X /></button>
      <header className="legal-modal-head">
        <span className="eyebrow coral"><ScrollText /> 약관·고지</span>
        <h2>{document?.title || '문서를 불러오는 중이에요'}</h2>
        {document && <p>{document.summary}</p>}
      </header>
      <div className="legal-modal-scroll">
        {error && <p className="legal-error"><ShieldAlert /> {error}</p>}
        {document ? <DocumentBody document={document} /> : !error && <p className="legal-loading">잠시만 기다려주세요.</p>}
      </div>
      <footer className="legal-modal-foot">
        <NavLink to={`/legal/${documentId}`} onClick={onClose}>전체 화면으로 보기 <ChevronRight /></NavLink>
        <button className="button" onClick={onClose}>닫기</button>
      </footer>
    </div>
  </div>
}

/** 동의 내역: 어떤 문서의 어느 버전에 언제 동의했는지. */
function ConsentHistory({ me, titles }: { me: MeState; titles: Map<string, string> }) {
  const consents: LegalConsentRecord[] = me.legalConsents || []
  if (!consents.length) {
    return <p className="legal-consent-empty">아직 기록된 동의가 없어요. 투자와 펀딩 신청을 진행하면 그 시점의 약관 버전과 동의 시각이 여기에 남습니다.</p>
  }
  return <div className="legal-consent-list">{consents.map((consent) => <article key={consent.id}>
    <div className="legal-consent-head">
      <b>{contextLabel[consent.context] || consent.context}</b>
      <time>{at(consent.agreedAt)}</time>
    </div>
    <p>{consent.documentIds.map((documentId) => titles.get(documentId) || documentId).join(' · ')}</p>
    <small>적용 약관 {consent.version}{typeof consent.amount === 'number' ? ` · ${won(consent.amount)}` : ''}</small>
  </article>)}</div>
}

export default function LegalCenter({ me }: { me: MeState | null }) {
  const { documentId } = useParams()
  const navigate = useNavigate()
  const index = useLegalIndex()
  const [document, setDocument] = useState<LegalDocument | undefined>()
  const [error, setError] = useState('')

  useEffect(() => {
    if (!documentId) { setDocument(undefined); return }
    let live = true
    setError('')
    loadLegalDocument(documentId)
      .then((result) => { if (live) setDocument(result) })
      .catch((cause) => { if (live) setError((cause as Error).message) })
    return () => { live = false }
  }, [documentId])

  const titles = new Map((index?.documents || []).map((item) => [item.id, item.title]))

  if (documentId) {
    return <div className="page-wrap legal-page">
      <button className="legal-back" onClick={() => navigate('/legal')}><ChevronLeft /> 전체 문서</button>
      {error && <p className="legal-error"><ShieldAlert /> {error}</p>}
      {document && <>
        <header className="legal-head">
          <span className="eyebrow coral"><ScrollText /> 약관·고지 {index?.version}</span>
          <h1>{document.title}</h1>
          <p>{document.summary}</p>
        </header>
        <DocumentBody document={document} />
      </>}
    </div>
  }

  return <div className="page-wrap legal-page">
    <header className="legal-head">
      <span className="eyebrow coral"><ScrollText /> 약관·고지</span>
      <h1>먹투 이용에 적용되는 문서</h1>
      <p>현재 적용 버전 <b>{index?.version || '불러오는 중'}</b> · 투자와 펀딩 신청을 진행하면 그 시점의 버전과 동의 시각이 기록됩니다.</p>
    </header>
    <div className="legal-draft-note"><ShieldAlert /><div>
      <b>이 문서들은 MVP 시연용 초안입니다</b>
      <p>실제 서비스 개시 전 변호사 검토와 금융당국 신고·등록 요건 확인이 필요하며, 그 결과에 따라 내용이 달라질 수 있습니다. 면책 문구만으로 금융 규제가 면제되지는 않습니다.</p>
    </div></div>
    <div className="legal-doc-grid">{(index?.documents || []).map((item) => <NavLink className="legal-doc-card" key={item.id} to={`/legal/${item.id}`}>
      <span className="legal-doc-icon"><FileText /></span>
      <div>
        <b>{item.title}</b>
        <p>{item.summary}</p>
        <div className="legal-doc-tags">
          {item.requiredFor.map((context) => <em key={context}>{contextLabel[context] || context} 필수 동의</em>)}
          {!item.requiredFor.length && <em className="optional">열람용</em>}
          {item.audience !== 'all' && <span>{item.audience === 'owner' ? '사장님' : '투자자'}</span>}
        </div>
      </div>
      <ChevronRight />
    </NavLink>)}</div>
    {me && <section className="legal-consent-section">
      <div className="subheading"><div><span><BadgeCheck /> 내 동의 기록</span><h2>언제, 어떤 버전에 동의했나요?</h2></div></div>
      <ConsentHistory me={me} titles={titles} />
    </section>}
  </div>
}
