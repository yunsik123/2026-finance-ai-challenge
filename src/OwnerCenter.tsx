import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { ArrowLeft, BadgeCheck, Banknote, Building2, Check, Database, Download, FileSpreadsheet, Landmark, Link2, LockKeyhole, PlugZap, ReceiptText, ShieldCheck, Store, UploadCloud, UserCheck, Users, type LucideIcon } from 'lucide-react'
import { api } from './lib/api.ts'
import OwnerDashboard from './OwnerDashboard.tsx'
import CouponVerify from './CouponVerify.tsx'
import VerificationReport from './VerificationReport.tsx'
import type { ApplicationResult, MeState, OcrAnalysis } from './types.ts'

const won = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`

type UploadOption = {
  id: string
  icon: LucideIcon
  title: string
  exact: string
  columns: string
  accept: string
  required?: boolean
  sampleUrl?: string
  sampleLabel?: string
}

const uploadOptions: UploadOption[] = [
  { id: 'business', icon: Building2, title: '사업자등록 자료', exact: '사업자등록증명 또는 사업자등록증 사본 1부', columns: '확인 항목: 상호, 대표자, 개업일, 사업장 주소, 업태·종목', accept: '.pdf,.jpg,.jpeg,.png', required: true, sampleUrl: '/samples/meoktu-business-sample.png', sampleLabel: 'OCR용 PNG 샘플' },
  { id: 'license', icon: BadgeCheck, title: '영업신고 자료', exact: '일반·휴게음식점 영업신고증 사본 1부', columns: '확인 항목: 신고번호, 영업소 명칭·주소, 영업 종류, 대표자', accept: '.pdf,.jpg,.jpeg,.png', required: true },
  { id: 'pos', icon: FileSpreadsheet, title: 'POS 매출 원자료', exact: '최근 12개월 일별 주문·결제 내역 CSV 또는 XLSX', columns: '필수 열: 영업일, 결제시각, 주문금액, 결제수단, 메뉴·수량, 취소·환불액', accept: '.csv,.xlsx,.xls', required: true, sampleUrl: '/samples/meoktu-pos-sample.csv', sampleLabel: 'POS CSV 샘플' },
  { id: 'account', icon: Landmark, title: '사업용 계좌 거래내역', exact: '최근 12개월 입출금 거래내역 CSV·XLSX 또는 은행 발급 PDF', columns: '필수 항목: 거래일시, 입출금액, 잔액, 거래상대방·적요. 계좌번호는 뒤 4자리 외 마스킹 권장', accept: '.csv,.xlsx,.xls,.pdf', required: true, sampleUrl: '/samples/meoktu-account-sample.csv', sampleLabel: '계좌 CSV 샘플' },
  { id: 'card', icon: ReceiptText, title: '카드·VAN·PG 정산자료', exact: '최근 12개월 카드 승인내역과 입금 정산내역', columns: '필수 항목: 승인일, 승인금액, 취소금액, 수수료, 정산일, 실제 입금액', accept: '.csv,.xlsx,.xls,.pdf', sampleUrl: '/samples/meoktu-card-settlement-sample.csv', sampleLabel: '카드 CSV 샘플' },
  { id: 'delivery', icon: Link2, title: '배달 플랫폼 자료', exact: '배민·쿠팡이츠·요기요 사장님 페이지의 최근 12개월 주문·정산 파일', columns: '권장 항목: 주문일, 주문금액, 수수료, 취소, 재주문, 평점. 이용하지 않으면 제출하지 않아도 됨', accept: '.csv,.xlsx,.xls,.pdf' },
  { id: 'tax', icon: Database, title: '홈택스 신고자료', exact: '최근 2개 과세기간 부가가치세 과세표준증명 또는 부가세 신고서', columns: '확인 항목: 신고 매출, 카드·현금영수증 발행분, 과세기간. 재무제표가 있으면 함께 제출', accept: '.pdf,.jpg,.jpeg,.png' },
  { id: 'customer', icon: Users, title: '재방문 산정자료', exact: '최근 12개월 POS 회원·예약·멤버십·배달 재주문 내역', columns: '고객 식별값은 해시·가명값만 허용. 이름, 전화번호, 주민번호 원문은 업로드 금지', accept: '.csv,.xlsx,.xls' },
  { id: 'lease', icon: Store, title: '임대차계약서', exact: '현재 유효한 사업장 임대차계약서의 임대 조건 페이지', columns: '확인 항목: 보증금, 월세, 관리비, 계약기간·만료일. 주민번호 뒷자리는 반드시 마스킹', accept: '.pdf,.jpg,.jpeg,.png' },
  { id: 'debt', icon: Banknote, title: '대출·상환 증빙', exact: '금융기관별 대출잔액증명서와 월별 원리금 상환 예정표', columns: '확인 항목: 잔액, 금리, 만기, 월 원리금. 계좌 거래내역의 실제 상환액과 교차검증', accept: '.pdf,.jpg,.jpeg,.png' },
  { id: 'staff', icon: Users, title: '직원·급여 증빙', exact: '최근 12개월 월별 직원 수와 급여 총액 또는 4대보험 사업장 가입자 수 자료', columns: '개별 직원 이름·주민번호는 제거하고 월별 인원·급여 합계만 제출', accept: '.csv,.xlsx,.xls,.pdf' },
]

const partnerOptions = [
  { id: 'pos', icon: FileSpreadsheet, title: 'POS 매출', provider: 'POS 제휴 중계', scope: '최근 12개월 주문·결제·취소 집계' },
  { id: 'account', icon: Landmark, title: '사업용 계좌', provider: '금융 마이데이터 중계', scope: '최근 12개월 입출금과 잔액' },
  { id: 'card', icon: ReceiptText, title: '카드·VAN 정산', provider: '카드 정산 제휴', scope: '승인·취소·수수료·실입금' },
  { id: 'delivery', icon: Link2, title: '배달 플랫폼', provider: '배달 플랫폼 제휴', scope: '주문·수수료·재주문 집계' },
  { id: 'tax', icon: Database, title: '세무 신고자료', provider: '세무자료 전송 어댑터', scope: '최근 2개 과세기간 신고매출' },
  { id: 'debt', icon: Banknote, title: '대출·상환정보', provider: '금융기관 대출정보 중계', scope: '잔액·금리·만기·월 상환액' },
] as const

type DocumentMetadata = { name: string; size: number; type: string; rowCount: number; headers: string[] }

const metricLabels: Record<string, string> = {
  recent12MonthAverageSales: '최근 12개월 평균매출', recent12MonthSalesGrowth: '최근 12개월 성장률', estimatedMonthlyOperatingCashflow: '추정 월 영업현금흐름', salesVolatility: '매출 변동성', repeatRate: '재방문율', averageTicket: '객단가', deliverySalesShare: '배달매출 비중', rentToSalesRatio: '임차료/매출', debtServiceToCashflowRatio: '원리금상환/현금흐름', operatingYears: '검증 업력', staffTrend: '직원 추이', districtSalesGrowth: '상권 매출 성장률', relativeSalesGrowth: '상권 대비 초과성장', salesReconciliationRate: '매출 교차검증 일치도'
}
const moneyMetrics = new Set(['recent12MonthAverageSales','estimatedMonthlyOperatingCashflow','averageTicket'])
const percentMetrics = new Set(['recent12MonthSalesGrowth','salesVolatility','repeatRate','deliverySalesShare','rentToSalesRatio','debtServiceToCashflowRatio','districtSalesGrowth','relativeSalesGrowth','salesReconciliationRate'])

export default function OwnerCenter({ me, onLogin, refresh, notify }: { me: MeState | null; onLogin: () => void; refresh: () => Promise<void>; notify: (message: string) => void }) {
  const owner = me?.user.role === 'owner'
  const demoMode = me?.user.sessionMode === 'demo'
  const [ownerData, setOwnerData] = useState<any>(null)
  const [showForm, setShowForm] = useState(!owner)
  const [uploadedFiles, setUploadedFiles] = useState<Record<string, string>>({})
  const [selectedFiles, setSelectedFiles] = useState<Record<string, File>>({})
  const [documentMetadata, setDocumentMetadata] = useState<Record<string, DocumentMetadata>>({})
  const [ocrResults, setOcrResults] = useState<Record<string, OcrAnalysis>>({})
  const [analyzingSource, setAnalyzingSource] = useState('')
  const [identityVerified, setIdentityVerified] = useState(false)
  const [result, setResult] = useState<ApplicationResult | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => { if (owner) api<any>('/api/owner').then(setOwnerData).catch(() => undefined) }, [owner, me?.applications.length])
  const restaurant = ownerData?.restaurants?.[0]
  const metrics = result?.data?.derivedMetrics || {}
  const confidence = result?.data?.dataConfidence || 0
  const uploadedCount = useMemo(() => Object.keys(uploadedFiles).length, [uploadedFiles])
  const activeConnections = ownerData?.dataConnections || me?.dataConnections || []
  const connectedIds = useMemo(() => new Set<string>(activeConnections.map((item: any) => item.sourceId)), [activeConnections])
  const evidenceCount = new Set([...Object.keys(uploadedFiles), ...connectedIds]).size

  const resetApplication = () => {
    setUploadedFiles({})
    setSelectedFiles({})
    setDocumentMetadata({})
    setOcrResults({})
    setIdentityVerified(false)
    setResult(null)
  }
  const beginApplication = () => {
    resetApplication()
    setShowForm(true)
  }
  const goBack = () => {
    resetApplication()
    setShowForm(false)
  }
  const selectFile = async (sourceId: string, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file && file.size > 10 * 1024 * 1024) {
      event.target.value = ''
      notify('업로드 파일은 10MB 이하여야 해요.')
      return
    }
    setUploadedFiles((current) => {
      const next = { ...current }
      if (file) next[sourceId] = file.name
      else delete next[sourceId]
      return next
    })
    setSelectedFiles((current) => {
      const next = { ...current }
      if (file) next[sourceId] = file
      else delete next[sourceId]
      return next
    })
    if (file) {
      let rowCount = 0
      let headers: string[] = []
      if (/\.csv$/i.test(file.name)) {
        const text = await file.text()
        const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim())
        headers = (lines[0] || '').split(',').map((item) => item.trim()).filter(Boolean).slice(0, 40)
        rowCount = Math.max(0, lines.length - 1)
      }
      setDocumentMetadata((current) => ({ ...current, [sourceId]: { name: file.name, size: file.size, type: file.type || 'application/octet-stream', rowCount, headers } }))
      notify(rowCount ? `${file.name}: ${headers.length}개 열·${rowCount}개 행을 확인했어요.` : `${file.name} 파일 형식과 크기를 확인했어요.`)
    } else {
      setDocumentMetadata((current) => { const next = { ...current }; delete next[sourceId]; return next })
    }
    setOcrResults((current) => { const next = { ...current }; delete next[sourceId]; return next })
  }
  const connectPartner = async (sourceId: string) => {
    if (demoMode) return notify('제휴기관 연결은 실제 로그인 계정에서만 원장에 저장돼요. 체험 모드에서는 샘플 파일 업로드와 AI 판독을 이용해주세요.')
    try {
      const response = await api<{ message: string }>(`/api/data-connections/${sourceId}`, { method: 'POST', body: JSON.stringify({ consent: true }) })
      notify(response.message)
      setOwnerData(await api<any>('/api/owner'))
      await refresh()
    } catch (error) { notify((error as Error).message) }
  }
  const analyzeDocument = async (sourceId: string) => {
    const file = selectedFiles[sourceId]
    if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type)) return notify('PNG, JPG 또는 WebP 이미지 문서만 AI 판독할 수 있어요.')
    if (file.size > 6 * 1024 * 1024) return notify('AI 판독 이미지는 6MB 이하여야 해요.')
    setAnalyzingSource(sourceId)
    try {
      const image = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('파일을 읽지 못했어요.')); reader.readAsDataURL(file) })
      const response = await api<{ message: string; analysis: OcrAnalysis }>('/api/ai/ocr', { method: 'POST', body: JSON.stringify({ image, filename: file.name, sourceId, plan: '펀딩 신청 원천자료 사전검증' }) })
      setOcrResults((current) => ({ ...current, [sourceId]: response.analysis })); notify(response.message)
    } catch (error) { notify((error as Error).message) }
    finally { setAnalyzingSource('') }
  }
  const sendDividend = async (fundId: string) => {
    try { const response = await api<{ message: string }>(`/api/owner/funds/${fundId}/dividend`, { method: 'POST', body: JSON.stringify({ discount: 10 }) }); notify(response.message); setOwnerData(await api<any>('/api/owner')); await refresh() }
    catch (error) { notify((error as Error).message) }
  }
  const toggleDisclosure = async () => {
    if (!restaurant) return
    try { const response = await api<{ message: string }>(`/api/owner/restaurants/${restaurant.id}/sales-disclosure`, { method: 'PATCH', body: JSON.stringify({ public: !restaurant.salesDisclosure }) }); notify(response.message); setOwnerData(await api<any>('/api/owner')); await refresh() }
    catch (error) { notify((error as Error).message) }
  }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!owner) { onLogin(); return }
    const form = new FormData(event.currentTarget)
    const connectedSources = [...Object.keys(uploadedFiles), ...(identityVerified ? ['identity'] : [])]
    const payload: Record<string, unknown> = {
      connectedSources,
      uploadedDocuments: uploadedFiles,
      documentMetadata,
      identityVerified,
      privacyConsent: form.get('privacyConsent') === 'true',
      creditConsent: form.get('creditConsent') === 'true',
    }
    if (demoMode) return notify('체험 모드는 파일 선택과 AI 판독까지만 가능해요. 심사 접수는 회원가입 후 진행해주세요.')
    for (const [key, value] of form.entries()) {
      if (key.startsWith('document-') || key.endsWith('Consent')) continue
      payload[key] = value
    }
    setSubmitting(true)
    try { const response = await api<{ message: string; application: ApplicationResult }>('/api/applications', { method: 'POST', body: JSON.stringify(payload) }); setResult(response.application); notify(response.message); await refresh() }
    catch (error) { notify((error as Error).message) }
    finally { setSubmitting(false) }
  }

  return <div className="owner-page owner-v2">
    <section className="owner-page-hero">
      <div><span className="eyebrow light"><Store /> 먹투 사장님 센터</span><h1>제출한 자료와<br /><em>기관 연결을 구분해요.</em></h1><p>사장님 직접 업로드와 제휴기관 전송을 출처별로 기록하고 POS·계좌·카드·세무·상권을 교차검증합니다.</p><div className="owner-values"><span><Check /> 출처 구분 원장</span><span><Check /> 6단계 교차검증</span><span><Check /> 부족한 자료는 미산정</span></div></div>
      <div className="review-flow data-flow"><b>펀딩 등록 흐름</b>{['사업자·대표자 인증','직접 업로드/기관연동 선택','최소 필수 동의 확인','먹투 자동 지표 계산','성장성·위험 심사','펀딩 등록과 공개범위 선택'].map((title,index) => <div key={title}><span>{index+1}</span><p>{title}</p><Check /></div>)}</div>
    </section>
    <div className="owner-body">
      {owner && restaurant && !showForm && !result && <>
        <OwnerDashboard data={ownerData} onDividend={sendDividend} onNewFund={beginApplication} />
        <CouponVerify refresh={refresh} notify={notify} />
        <section className="sales-disclosure-control"><div><span><BarChartIcon /></span><div><b>투자자 매출 데이터 공개</b><p>보너스 산정 결과는 항상 공개하고, 정확한 월매출 그래프는 사장님이 선택합니다.</p></div></div><button className={restaurant.salesDisclosure ? 'active' : ''} onClick={toggleDisclosure}><i />{restaurant.salesDisclosure ? '월매출 공개 중' : '월매출 비공개'}</button></section>
        {ownerData?.auditEvents?.length > 0 && <section className="owner-audit"><div><span className="eyebrow">AUDIT TRAIL</span><h2>내 계정 변경 이력</h2><p>승재 프로젝트의 감사 로그 설계를 가져와 중요한 변경을 서버 원장에 남깁니다.</p></div><div>{ownerData.auditEvents.slice(0, 8).map((event: any) => <article key={event.id}><span><Check /></span><div><b>{event.summary}</b><small>{new Date(event.createdAt).toLocaleString('ko-KR')} · {event.action}</small></div></article>)}</div></section>}
      </>}

      {demoMode && <section className="demo-mode-banner"><ShieldCheck /><div><b>저장되지 않는 사장님 체험 모드</b><p>샘플 파일 다운로드·로컬 업로드·AI OCR 판독만 가능합니다. 기관 연결, 심사 접수, 쿠폰 확인과 원장 변경은 실제 로그인 계정에서만 가능합니다.</p></div></section>}

      {result ? <section className="source-review-result">
        <div className="result-score"><span>먹투 자동분석 점수</span><b>{result.score}<small>/100</small></b><strong>{result.status === 'approved' ? '펀딩 가능' : result.status === 'conditional' ? '조건부 승인' : result.status === 'manual_review' ? '추가자료 검토' : '재신청 필요'}</strong></div>
        <div className="confidence-card"><span>데이터 신뢰도</span><b>{confidence}%</b><div className="progress-track"><i style={{ width: `${confidence}%` }} /></div><small>{result.data?.connectedSources?.length || 0}개 원천자료·인증 기준</small></div>
        {result.data?.sourceProvenance && <div className="source-provenance-result"><div><b>사장님 직접 업로드</b><span>{result.data.sourceProvenance.ownerUploaded?.join(', ') || '없음'}</span></div><div><b>제휴기관 연결</b><span>{result.data.sourceProvenance.partnerConnected?.join(', ') || '없음'}</span></div></div>}
        <h2>먹투가 자동 계산한 Restaurant Health Profile</h2>
        <div className="derived-metrics">{Object.entries(metrics).map(([key,value]) => <div className={value === null ? 'missing' : ''} key={key}><span>{metricLabels[key] || key}</span><b>{value === null ? '미산정' : moneyMetrics.has(key) && typeof value === 'number' ? won(value) : percentMetrics.has(key) ? `${value}%` : key === 'operatingYears' ? `${value}년` : String(value)}</b></div>)}</div>
        <VerificationReport business={result.data?.businessVerification} financial={result.data?.financialVerification} />
        <div className="result-columns"><section><h3>확인된 강점</h3>{result.strengths.map((item) => <p key={item}><Check /> {item}</p>)}</section><section><h3>보강하면 좋은 자료</h3>{result.improvements.map((item) => <p key={item}>{item}</p>)}</section></div>
        <div className="result-explanation"><b>심사 설명</b><p>{result.explanation}</p><span>승인 가능 한도 {won(result.approvedLimit)}</span></div>
        <button className="button" onClick={goBack}>사장님 센터로 돌아가기</button>
      </section> : (!owner || showForm || !restaurant) && <form className={`application-form source-application ${!owner ? 'locked' : ''}`} onSubmit={submit}>
        {!owner && <div className="owner-lock-overlay"><LockKeyhole /><h2>사장님 계정 전용 기능이에요</h2><p>상호명과 자료 업로드를 포함한 모든 입력은 소상공인 계정으로 로그인한 뒤 사용할 수 있습니다.</p><button type="button" className="button" onClick={onLogin}>{me ? '소상공인 계정으로 다시 로그인' : '로그인·회원가입'}</button></div>}
        <fieldset disabled={!owner}>
          {owner && restaurant && showForm && <button type="button" className="application-back" onClick={goBack}><ArrowLeft /> 사장님 센터로 돌아가기</button>}
          <div className="form-heading"><span>원천데이터 기반 예비심사</span><h2>필요한 자료를 하나씩 제출해주세요</h2><p>매출액·성장률·재방문율은 직접 입력하지 않습니다. 각 자료의 정확한 범위와 항목을 확인하고 파일을 선택하면 먹투가 계산합니다.</p></div>

          <section className="form-section">
            <div className="form-section-title"><span>1</span><div><h3>사업체 기본정보와 대표자 확인</h3><p>상권 자료는 주소를 기준으로 먹투가 직접 수집합니다.</p></div></div>
            <div className="field-grid"><label className="field"><span>상호명</span><input name="restaurantName" required placeholder="예: 소복소복" /></label><label className="field"><span>대표자명</span><input name="ownerName" required placeholder="사업자등록증과 동일하게" /></label><label className="field"><span>사업자등록번호</span><input name="businessNumber" required placeholder="000-00-00000" /></label><label className="field"><span>영업신고번호</span><input name="licenseNumber" required placeholder="신고번호 입력" /></label><label className="field full-field"><span>사업장 주소</span><input name="address" required placeholder="상권·경쟁·생활인구 분석에 사용됩니다." /></label></div>
            <button type="button" className={`identity-action ${identityVerified ? 'verified' : ''}`} onClick={() => setIdentityVerified(true)}><UserCheck />{identityVerified ? '대표자 본인인증 완료' : '휴대전화로 대표자 본인인증'}<span>{identityVerified ? '신청자와 대표자 일치 여부를 확인했습니다.' : 'MVP에서는 버튼을 누르면 시연용 인증이 완료됩니다.'}</span></button>
          </section>

          <section className="form-section evidence-source-section">
            <div className="form-section-title"><span>2</span><div><h3>자료를 가져오는 방법을 구분해주세요</h3><p>기관에서 동의 기반으로 전송받은 자료와 사장님이 직접 올린 파일을 원장에 서로 다른 출처로 남깁니다.</p></div></div>
            <div className="source-progress"><div><b>{evidenceCount}개</b><span>확보 자료</span></div><div className="progress-track"><i style={{ width: `${Math.min(100, evidenceCount / uploadOptions.length * 100)}%` }} /></div><small>필수: 사업자등록·영업신고 + POS·사업계좌(기관 연결 또는 직접 업로드)</small></div>

            <div className="evidence-lane partner-lane"><div className="evidence-lane-heading"><PlugZap /><div><b>A. 제휴기관·마이데이터형 연결</b><p>실제 계정에서 동의 범위·제공기관·동기화 시각이 서버 원장에 저장됩니다. 현재 버튼은 기관 API 대신 시연 어댑터를 사용합니다.</p></div></div><div className="partner-connection-grid">{partnerOptions.map((option) => { const Icon = option.icon; const connection = activeConnections.find((item: any) => item.sourceId === option.id); return <article className={connection ? 'connected' : ''} key={option.id}><Icon /><div><b>{option.title}</b><span>{option.provider}</span><small>{option.scope}</small>{connection && <em><Check /> {connection.recordCount.toLocaleString()}건 · {new Date(connection.lastSyncedAt).toLocaleDateString('ko-KR')}</em>}</div><button type="button" disabled={Boolean(connection) || demoMode} onClick={() => connectPartner(option.id)}>{connection ? '연결됨' : demoMode ? '로그인 필요' : '동의하고 연결'}</button></article> })}</div></div>

            <div className="evidence-lane upload-lane"><div className="evidence-lane-heading"><UploadCloud /><div><b>B. 소상공인 직접 업로드</b><p>사업자·영업신고·임대차처럼 직접 보유한 문서 또는 기관 연결이 어려울 때의 대체 파일입니다. CSV는 브라우저에서 열·행 수를 확인합니다.</p></div></div><div className="document-upload-grid">{uploadOptions.map((option) => <DocumentUploadCard key={option.id} option={option} fileName={uploadedFiles[option.id]} metadata={documentMetadata[option.id]} required={Boolean(option.required && !connectedIds.has(option.id))} onChange={(event) => selectFile(option.id, event)} />)}</div></div>
            {Object.entries(selectedFiles).some(([, file]) => /^image\/(png|jpeg|webp)$/.test(file.type)) && <div className="ocr-workbench"><div><Database /><div><b>AI OCR 원본 교차검증</b><p>이미지 문서의 사업자번호·날짜·금액을 구조화합니다. 판독 결과는 승인 결정이 아니며, 원본 이미지는 DB에 저장하지 않습니다.</p></div></div>{Object.entries(selectedFiles).filter(([, file]) => /^image\/(png|jpeg|webp)$/.test(file.type)).map(([sourceId, file]) => { const analysis = ocrResults[sourceId]; const result = analysis?.result; return <article key={sourceId}><div><b>{file.name}</b><span>{uploadOptions.find((option) => option.id === sourceId)?.title}</span></div>{analysis ? <div className="ocr-result"><strong>{analysis.status === 'ai_extracted' ? 'AI 구조화 완료' : '수동 검토 대기'}</strong><span>{result.documentType || '문서 종류 미확인'} · 신뢰도 {Math.round((result.confidence || 0) * 100)}%</span>{result.businessNumber && <small>사업자번호 {result.businessNumber}</small>}{result.total ? <small>판독 금액 {won(result.total)}</small> : null}{result.warnings?.map((warning) => <small className="warning" key={warning}>{warning}</small>)}</div> : <button type="button" disabled={Boolean(analyzingSource)} onClick={() => analyzeDocument(sourceId)}>{analyzingSource === sourceId ? 'AI가 문서를 읽는 중...' : 'AI 문서 판독'}</button>}</article> })}</div>}
            <p className="mvp-source-note">MVP는 직접 업로드 파일의 이름·크기·형식과 CSV 열·행 수를 검증해 심사 출처로 기록합니다. 이미지에서 ‘AI 문서 판독’을 누른 경우에만 서버 AI로 전송하며 원본 이미지는 저장하지 않습니다. 실제 기관 연결은 현재 모의 어댑터이고, 운영 전 기관 OAuth·전자서명·암호화 보관으로 교체해야 합니다.</p>
          </section>

          <section className="form-section legal-consent-section">
            <div className="form-section-title"><span>3</span><div><h3>분석에 꼭 필요한 동의만 확인</h3><p>마케팅·광고·제3자 제공 동의는 받지 않습니다. 아래 두 항목은 제출자료를 심사에 처리하기 위한 필수 동의입니다.</p></div></div>
            <label className="legal-consent-card"><input type="checkbox" name="privacyConsent" value="true" required /><Check /><div><strong>[필수] 개인정보 수집·이용 동의</strong><p><b>목적</b> 대표자·사업체 확인, 펀딩 적격성 심사, 결과 설명 및 부정 신청 방지</p><p><b>항목</b> 대표자명·연락정보, 사업자·영업신고·임대차·직원 집계자료에 포함된 개인정보</p><p><b>보유</b> 심사 종료 또는 신청 철회 후 90일까지. 관계 법령상 별도 보존 의무가 있으면 해당 기간</p><small>동의를 거부할 수 있으나 대표자 확인과 심사를 진행할 수 없습니다.</small></div></label>
            <label className="legal-consent-card"><input type="checkbox" name="creditConsent" value="true" required /><Check /><div><strong>[필수] 개인(신용)정보 수집·이용 동의</strong><p><b>목적</b> 실제 매출·현금흐름·상환부담 교차검증과 펀딩 가능 한도 산정</p><p><b>항목</b> 사업용 계좌 거래, 카드 정산, 대출잔액·금리·만기·원리금 상환 정보</p><p><b>보유</b> 심사 종료 또는 신청 철회 후 90일까지. 관계 법령상 별도 보존 의무가 있으면 해당 기간</p><small>동의를 거부할 수 있으나 핵심 현금흐름 검증과 자동심사를 진행할 수 없습니다.</small></div></label>
            <div className="automated-analysis-note"><ShieldCheck /><p><b>자동분석 안내</b> 먹투 모델은 예비 점수와 설명을 만들지만 자동으로 최종 거절하지 않습니다. 자료 부족·불일치는 수동 심사로 보내며, 사장님은 결과 설명과 재검토를 요청할 수 있습니다.</p></div>
          </section>

          <section className="form-section">
            <div className="form-section-title"><span>4</span><div><h3>사장님이 직접 작성할 내용</h3><p>데이터만으로 알 수 없는 자금 목적과 실행계획만 직접 설명해주세요.</p></div></div>
            <div className="field-grid"><label className="field"><span>희망 펀딩액</span><div className="number-field"><input type="number" name="requestedLimit" defaultValue={30000000} min={5000000} step={1000000} required /><span>원</span></div></label><label className="field"><span>필요 기간</span><div className="number-field"><input type="number" name="fundingPeriodMonths" defaultValue={18} min={3} max={36} required /><span>개월</span></div></label><label className="field"><span>사장 자기자금</span><div className="number-field"><input type="number" name="ownCapital" defaultValue={10000000} min={0} step={1000000} required /><span>원</span></div></label><label className="field"><span>최대 쿠폰 할인율</span><select name="maxDiscount" defaultValue="40"><option value="30">30%</option><option value="35">35%</option><option value="40">40%</option><option value="45">45%</option><option value="50">50%</option></select></label></div>
            <label className="field"><span>자금 사용계획</span><textarea name="fundPurpose" rows={3} required placeholder="예: 저온 저장고 1,800만원 / 주방 동선 개선 1,200만원" /></label><label className="field"><span>사업계획과 차별성</span><textarea name="businessPlan" rows={4} required placeholder="왜 고객이 다시 찾는지, 자금을 어떻게 성장으로 연결할지 설명해주세요." /></label><label className="field"><span>예상 효과</span><textarea name="expectedEffect" rows={3} required placeholder="예: 좌석 24→38석, 점심 회전율 개선, 품절 감소" /></label>
          </section>

          <section className="three-check-system"><h3>먹투 3중 검증</h3><div><span>① 공식자료</span><p>사업자·홈택스·대출·임대차</p></div><div><span>② 실제 영업자료</span><p>POS·카드·계좌·배달</p></div><div><span>③ 외부자료</span><p>상권·리뷰·고객수요·경쟁</p></div><small>서로 맞지 않는 값은 원인을 분류하고 수동 심사 대상으로 표시합니다.</small></section>
          <button className="button full huge" disabled={submitting || !identityVerified || demoMode}>{demoMode ? '체험 모드는 심사 접수 불가 · 회원가입 후 이용' : submitting ? '원천데이터를 교차검증하고 있어요...' : !identityVerified ? '대표자 본인인증을 먼저 완료해주세요' : '먹투 자동분석 시작'} <Database /></button>
          <p className="form-disclaimer">이 결과는 공식 SCB 등급이나 최종 펀딩 승인이 아닙니다. 실제 서비스 출시 전 개인정보·신용정보 처리 구조와 보유기간은 전문 법률 검토 및 제휴기관 요건 확인이 필요합니다.</p>
        </fieldset>
      </form>}
    </div>
  </div>
}

function DocumentUploadCard({ option, fileName, metadata, required, onChange }: { option: UploadOption; fileName?: string; metadata?: DocumentMetadata; required: boolean; onChange: (event: ChangeEvent<HTMLInputElement>) => void }) {
  const Icon = option.icon
  return <div className={`document-upload-card ${fileName ? 'uploaded' : ''}`}>
    <span className="document-icon"><Icon /></span>
    <div className="document-copy"><span className={required ? 'required' : 'optional'}>{required ? '필수 제출' : option.required ? '기관연동 대체 가능' : '선택 제출'}</span><b>{option.title}</b><p>{option.exact}</p><small>{option.columns}</small>{fileName && <strong><Check /> {fileName}{metadata?.rowCount ? ` · ${metadata.headers.length}열 ${metadata.rowCount}행` : ''}</strong>}{option.sampleUrl && <a className="sample-download" href={option.sampleUrl} download><Download /> {option.sampleLabel} 다운로드</a>}</div>
    <label className="document-action"><UploadCloud />{fileName ? '다시 선택' : '파일 선택'}<input type="file" name={`document-${option.id}`} accept={option.accept} required={required} onChange={onChange} /></label>
  </div>
}

function BarChartIcon() { return <Database /> }
