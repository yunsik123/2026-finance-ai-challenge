/**
 * 제출 자료 내용 보기.
 *
 * 지금까지 자료는 파일명·크기·열 이름만 보였다. 사장님은 방금 올린 샘플이 무엇인지 몰랐고,
 * 운영자는 "제출된 자료"를 보면서도 그 안의 숫자를 확인할 방법이 없었다.
 *
 * 여기서는 두 화면이 같은 창을 쓴다.
 *  - 사장님 화면: 방금 고른 File 을 브라우저에서 바로 읽는다. 서버로 올리지 않고, 내려받지도 않는다.
 *  - 운영자 화면: 접수 때 저장해 둔 표 미리보기와 공개 샘플 원본을 읽는다.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, FileSpreadsheet, FileText, Image as ImageIcon, X } from 'lucide-react'
import './document-viewer.css'

export type TablePreview = {
  kind: 'table'
  headers: string[]
  rows: string[][]
  totalRows: number
  truncated: boolean
}

/** 서버가 신청서에 저장해 둔 자료 한 건의 메타데이터. */
export type SubmittedDocument = {
  name: string
  size?: number
  type?: string
  rowCount?: number
  headers?: string[]
  preview?: TablePreview
  /** 공개 샘플 자료로 접수한 경우에만 채워지는 원본 주소. */
  sampleUrl?: string
}

export const fileSizeLabel = (value: unknown) => {
  const bytes = Number(value) || 0
  if (!bytes) return '크기 미확인'
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`
}

const extensionOf = (name: string) => (name.split('.').pop() || '').toLowerCase()
export const isImageDocument = (name: string, type = '') => /^image\//.test(type) || ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(extensionOf(name))
export const isPdfDocument = (name: string, type = '') => type === 'application/pdf' || extensionOf(name) === 'pdf'
export const isTableDocument = (name: string) => ['csv', 'xlsx', 'xls'].includes(extensionOf(name))

/**
 * 따옴표로 감싼 칸과 그 안의 쉼표를 지키는 CSV 파서.
 * 서버의 parseCsv 와 같은 규칙이어야 사장님 화면과 운영자 화면이 같은 표를 보여준다.
 */
export function parseCsvPreview(text: string, maxRows = 200): TablePreview | undefined {
  const clean = text.replace(/^﻿/, '')
  if (!clean.trim()) return undefined
  const lines: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < clean.length; index += 1) {
    const character = clean[index]
    if (quoted) {
      if (character === '"') {
        if (clean[index + 1] === '"') { cell += '"'; index += 1 } else quoted = false
      } else cell += character
      continue
    }
    if (character === '"') { quoted = true; continue }
    if (character === ',') { row.push(cell); cell = ''; continue }
    if (character === '\n' || character === '\r') {
      if (character === '\r' && clean[index + 1] === '\n') index += 1
      row.push(cell); cell = ''
      if (row.some((item) => item.trim())) lines.push(row)
      row = []
      continue
    }
    cell += character
  }
  row.push(cell)
  if (row.some((item) => item.trim())) lines.push(row)

  const headers = (lines.shift() || []).map((item) => item.trim())
  if (!headers.length) return undefined
  const body = lines.map((line) => headers.map((_, index) => (line[index] ?? '').trim()))
  return { kind: 'table', headers, rows: body.slice(0, maxRows), totalRows: body.length, truncated: body.length > maxRows }
}

/** 표 자료를 그대로 그린다. 가로로 긴 원장이라 표 자체가 가로 스크롤을 갖는다. */
export function DocumentTable({ preview }: { preview: TablePreview }) {
  return <div className="doc-table-wrap">
    <table className="doc-table">
      <thead><tr><th className="doc-table-index">#</th>{preview.headers.map((header, index) => <th key={`${header}-${index}`}>{header || '　'}</th>)}</tr></thead>
      <tbody>{preview.rows.map((row, rowIndex) => <tr key={rowIndex}>
        <td className="doc-table-index">{rowIndex + 1}</td>
        {row.map((value, cellIndex) => <td key={cellIndex}>{value}</td>)}
      </tr>)}</tbody>
    </table>
    <p className="doc-table-note">{preview.truncated
      ? `전체 ${preview.totalRows.toLocaleString('ko-KR')}행 중 위 ${preview.rows.length.toLocaleString('ko-KR')}행을 보여주고 있어요.`
      : `전체 ${preview.totalRows.toLocaleString('ko-KR')}행을 모두 보여주고 있어요.`}</p>
  </div>
}

/** 자료 창의 껍데기. 제목·요약 줄·본문만 받아 쓴다. */
export function DocumentModal({ title, filename, meta, badge, children, onClose }: {
  title: string
  filename: string
  meta: string
  badge?: ReactNode
  children: ReactNode
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return <div className="doc-backdrop" onMouseDown={onClose} role="dialog" aria-modal="true" aria-label={`${title} 내용 보기`}>
    <article className="doc-modal" onMouseDown={(event) => event.stopPropagation()}>
      <header className="doc-modal-head">
        <div><span>제출 자료 내용 보기</span><h2>{title}</h2><p>{filename}</p><small>{meta}</small></div>
        <button type="button" onClick={onClose} aria-label="닫기"><X /></button>
      </header>
      {badge}
      <div className="doc-modal-body">{children}</div>
    </article>
  </div>
}

/** 이미지·PDF 원본을 창 안에서 바로 연다. 내려받지 않고 보기만 한다. */
function EmbeddedOriginal({ url, name, type }: { url: string; name: string; type?: string }) {
  if (isImageDocument(name, type)) return <figure className="doc-figure"><img src={url} alt={`${name} 원본 이미지`} /></figure>
  if (isPdfDocument(name, type)) return <iframe className="doc-frame" src={url} title={`${name} 원본 문서`} />
  return null
}

/**
 * 사장님 화면: 방금 고른 파일을 브라우저에서 그대로 연다.
 * 표는 표로, 이미지·PDF 는 원본 그대로, 나머지는 앞부분 텍스트로 보여준다.
 */
export function LocalFileViewer({ file }: { file: File }) {
  const [table, setTable] = useState<TablePreview | undefined>()
  const [text, setText] = useState('')
  const [state, setState] = useState<'loading' | 'ready' | 'unsupported'>('loading')
  const objectUrl = useMemo(() => URL.createObjectURL(file), [file])
  useEffect(() => () => URL.revokeObjectURL(objectUrl), [objectUrl])

  useEffect(() => {
    let live = true
    const load = async () => {
      if (isImageDocument(file.name, file.type) || isPdfDocument(file.name, file.type)) { setState('ready'); return }
      if (/\.csv$/i.test(file.name)) {
        const parsed = parseCsvPreview(await file.text())
        if (!live) return
        setTable(parsed)
        setState(parsed ? 'ready' : 'unsupported')
        return
      }
      if (/\.(txt|json|md)$/i.test(file.name) || /^text\//.test(file.type)) {
        const raw = await file.text()
        if (!live) return
        setText(raw.slice(0, 20000))
        setState('ready')
        return
      }
      // xlsx 같은 이진 표 자료는 브라우저에서 열 수 없다. 파일 정보만 정확히 알린다.
      setState('unsupported')
    }
    void load().catch(() => { if (live) setState('unsupported') })
    return () => { live = false }
  }, [file])

  if (state === 'loading') return <p className="doc-note">자료를 읽는 중이에요...</p>
  if (isImageDocument(file.name, file.type) || isPdfDocument(file.name, file.type)) {
    return <EmbeddedOriginal url={objectUrl} name={file.name} type={file.type} />
  }
  if (table) return <DocumentTable preview={table} />
  if (text) return <pre className="doc-text">{text}</pre>
  return <p className="doc-note"><AlertTriangle /> 이 형식({extensionOf(file.name).toUpperCase() || '알 수 없음'})은 브라우저에서 바로 열어볼 수 없어요. CSV·이미지·PDF 자료는 그대로 확인할 수 있습니다.</p>
}

/**
 * 운영자 화면: 접수 때 저장해 둔 내용을 연다.
 *
 * 표 자료는 상단 일부 행을 그대로 보여주고, 공개 샘플로 접수했다면 원본 파일을 그대로 띄운다.
 * 사장님이 올린 실제 이미지·PDF 원본은 보관하지 않기로 한 자료라서, 그 자리에는
 * 무엇을 왜 볼 수 없는지와 AI 판독 결과를 대신 보여준다.
 */
export function SubmittedDocumentViewer({ document: item, ocr }: { document: SubmittedDocument; ocr?: Record<string, any> }) {
  const sections: ReactNode[] = []
  if (item.preview?.headers?.length) {
    sections.push(<section key="table" className="doc-section">
      <h3><FileSpreadsheet /> 표 내용</h3>
      <DocumentTable preview={item.preview} />
      {item.rowCount && item.rowCount > item.preview.totalRows
        ? <p className="doc-note">접수 시 확인한 원본은 {item.rowCount.toLocaleString('ko-KR')}행이며, 심사 원장에는 위 미리보기만 보관합니다.</p>
        : null}
    </section>)
  }
  if (item.sampleUrl) {
    sections.push(<section key="original" className="doc-section">
      <h3><ImageIcon /> 원본 문서</h3>
      <EmbeddedOriginal url={item.sampleUrl} name={item.name} type={item.type} />
      {isTableDocument(item.name) && <p className="doc-note">공개 샘플 자료로 접수한 신청이라 원본 파일을 그대로 확인할 수 있어요.</p>}
    </section>)
  }
  if (ocr) {
    const result = (ocr.result || {}) as Record<string, any>
    const fields: Array<[string, string]> = [
      ['문서 종류', result.documentType || '-'],
      ['상호', result.merchant || '-'],
      ['사업자번호', result.businessNumber || '-'],
      ['문서 기준일', result.date || '-'],
      ['판독 금액', Number.isFinite(Number(result.total)) && Number(result.total) ? `${Math.round(Number(result.total)).toLocaleString('ko-KR')}원` : '-'],
      ['자금계획 부합', result.planMatch || '-'],
    ]
    sections.push(<section key="ocr" className="doc-section">
      <h3><FileText /> AI 문서 판독 결과 <small>신뢰도 {Math.round((Number(result.confidence) || 0) * 100)}%</small></h3>
      <div className="doc-fields">{fields.map(([label, value]) => <div key={label}><small>{label}</small><b>{value}</b></div>)}</div>
      {result.rawText ? <pre className="doc-text">{String(result.rawText).slice(0, 4000)}</pre> : null}
      {(result.warnings || []).map((warning: string) => <p className="doc-note warn" key={warning}><AlertTriangle /> {warning}</p>)}
    </section>)
  }
  if (!sections.length) {
    sections.push(<p className="doc-note" key="none"><AlertTriangle /> 이 자료는 원본을 보관하지 않아 내용을 열어볼 수 없어요. 이미지·PDF 증빙은 접수 시 AI 판독으로 구조화한 값만 남기고 원본은 저장하지 않습니다. 원본 확인이 필요하면 사장님에게 재제출을 요청해주세요.</p>)
  }
  return <>
    <div className="doc-fields doc-fields-meta">
      <div><small>파일명</small><b>{item.name}</b></div>
      <div><small>크기</small><b>{fileSizeLabel(item.size)}</b></div>
      <div><small>형식</small><b>{item.type || '형식 미확인'}</b></div>
      <div><small>행 수</small><b>{item.rowCount ? `${item.rowCount.toLocaleString('ko-KR')}행` : '표 아님'}</b></div>
    </div>
    {sections}
  </>
}
