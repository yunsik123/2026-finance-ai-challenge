/**
 * 만능 업로드함이 쓰는 파일 변환기.
 *
 * 사장님이 실제로 들고 오는 자료는 세무사가 준 PDF, 은행에서 내린 엑셀,
 * POS 화면을 찍은 사진이다. 지금까지 서버가 실제로 읽을 수 있던 것은 CSV와 이미지뿐이라
 * PDF·엑셀을 올려도 "이름과 크기만 확인"에 그쳤다.
 *
 * 여기서 브라우저가 먼저 바꿔서 보낸다.
 *   PDF  → 첫 페이지를 PNG 로 그려서 기존 이미지 판독 경로에 그대로 태운다.
 *   XLSX → 시트를 CSV 문자열로 바꿔서 기존 표 집계 경로에 그대로 태운다.
 * 서버의 입력 형식은 하나도 건드리지 않는다.
 *
 * XLSX 는 외부 라이브러리를 쓰지 않는다. npm 의 xlsx 0.18.5 는 수정본이 없는
 * 프로토타입 오염·ReDoS 권고가 걸려 있어서(GHSA-4r6h-8v6p-xvw6) 의존성으로 넣지 않았다.
 * .xlsx 는 ZIP 안의 XML 이라, 브라우저의 DecompressionStream 과 DOMParser 로 직접 읽는다.
 */

/** 파일 내용 해시. 문서함이 같은 파일을 두 번 등록하지 않게 하는 열쇠다. */
export async function hashFile(file: File) {
  const buffer = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export type IntakeKind = 'csv' | 'sheet' | 'image' | 'pdf' | 'unknown'

export function kindOf(file: File): IntakeKind {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv') || file.type === 'text/csv') return 'csv'
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) return 'sheet'
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return 'pdf'
  if (/^image\/(png|jpeg|jpg|webp)$/.test(file.type) || /\.(png|jpe?g|webp)$/.test(name)) return 'image'
  return 'unknown'
}

/* ── PDF → PNG ─────────────────────────────────────────────── */

/**
 * PDF 첫 페이지를 PNG data URL 로 만든다.
 *
 * 서버의 판독 경로는 data:image/(png|jpeg|webp) 만 받는다. 그 정규식을 넓히는 대신
 * 브라우저에서 그림으로 바꾼다. 판독에 필요한 것은 문서에 적힌 값이고,
 * 대부분의 증빙은 첫 페이지에 상호·사업자번호·금액이 다 있다.
 *
 * pdfjs 는 무겁기 때문에 실제로 PDF 를 올릴 때만 동적으로 불러온다.
 */
export async function pdfFirstPageToPng(file: File, maxWidth = 1600): Promise<{ dataUrl: string; pageCount: number }> {
  const pdfjs = await import('pdfjs-dist')
  // 워커 파일을 번들에서 뽑아 쓴다. CDN 을 참조하면 오프라인 심사 환경에서 깨진다.
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default

  const data = new Uint8Array(await file.arrayBuffer())
  const loading = pdfjs.getDocument({ data })
  const document = await loading.promise
  try {
    const page = await document.getPage(1)
    const base = page.getViewport({ scale: 1 })
    // 글자가 뭉개지면 판독이 실패한다. 가로 1600px 정도까지 키워서 그린다.
    const scale = Math.min(3, Math.max(1, maxWidth / base.width))
    const viewport = page.getViewport({ scale })
    const canvas = document_createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('브라우저에서 PDF를 그릴 수 없어요.')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvas, canvasContext: context, viewport }).promise
    return { dataUrl: canvas.toDataURL('image/png'), pageCount: document.numPages }
  } finally {
    // 워커와 네트워크 요청을 함께 정리한다. 문서 프록시가 아니라 로딩 작업이 destroy 를 갖는다.
    await loading.destroy().catch(() => undefined)
  }
}

function document_createCanvas(width: number, height: number) {
  const canvas = window.document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

/* ── XLSX → CSV ────────────────────────────────────────────── */

type ZipEntry = { name: string; compression: number; start: number; size: number }

/**
 * ZIP 의 중앙 디렉터리를 읽어 항목 목록을 만든다.
 * 로컬 헤더만 훑으면 데이터 서술자(크기가 뒤에 오는 경우)에서 어긋난다.
 */
function readZipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // End of central directory 서명(0x06054b50)을 뒤에서부터 찾는다.
  let end = -1
  for (let offset = bytes.length - 22; offset >= 0 && offset > bytes.length - 66000; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) { end = offset; break }
  }
  if (end < 0) throw new Error('엑셀 파일 구조를 읽지 못했어요.')
  const count = view.getUint16(end + 10, true)
  let pointer = view.getUint32(end + 16, true)
  const entries: ZipEntry[] = []
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(pointer, true) !== 0x02014b50) break
    const compression = view.getUint16(pointer + 10, true)
    const compressedSize = view.getUint32(pointer + 20, true)
    const nameLength = view.getUint16(pointer + 28, true)
    const extraLength = view.getUint16(pointer + 30, true)
    const commentLength = view.getUint16(pointer + 32, true)
    const localOffset = view.getUint32(pointer + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength))
    // 로컬 헤더에서 실제 데이터 시작 위치를 다시 계산한다.
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    entries.push({
      name, compression,
      start: localOffset + 30 + localNameLength + localExtraLength,
      size: compressedSize,
    })
    pointer += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

async function inflate(bytes: Uint8Array, compression: number) {
  if (compression === 0) return bytes
  if (compression !== 8) throw new Error('지원하지 않는 엑셀 압축 방식이에요.')
  const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function readZipText(bytes: Uint8Array, entries: ZipEntry[], name: string) {
  const entry = entries.find((item) => item.name === name)
  if (!entry) return ''
  const raw = bytes.subarray(entry.start, entry.start + entry.size)
  return new TextDecoder().decode(await inflate(raw, entry.compression))
}

/** 'B12' → { column: 1, row: 11 } (0부터). */
function cellAddress(reference: string) {
  const match = reference.match(/^([A-Z]+)(\d+)$/)
  if (!match) return undefined
  let column = 0
  for (const character of match[1]) column = column * 26 + (character.charCodeAt(0) - 64)
  return { column: column - 1, row: Number(match[2]) - 1 }
}

const csvCell = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)

/**
 * .xlsx 의 첫 시트를 CSV 문자열로 바꾼다.
 *
 * 서식·수식·차트는 버린다. 지표 계산기가 필요한 것은 열 이름과 값뿐이다.
 * 수식 셀은 계산된 값(<v>)을 쓴다.
 */
export async function sheetToCsv(file: File, maxRows = 20000): Promise<{ csv: string; sheetName: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const entries = readZipEntries(bytes)
  const parser = new DOMParser()

  // 공유 문자열 표. 텍스트 셀은 여기 색인만 갖고 있다.
  const sharedXml = await readZipText(bytes, entries, 'xl/sharedStrings.xml')
  const shared: string[] = []
  if (sharedXml) {
    const document = parser.parseFromString(sharedXml, 'application/xml')
    for (const item of [...document.getElementsByTagName('si')]) {
      // <si> 안에 <r> 조각으로 쪼개진 서식 있는 문자열은 <t> 를 모두 이어야 원문이 된다.
      shared.push([...item.getElementsByTagName('t')].map((node) => node.textContent || '').join(''))
    }
  }

  // 첫 시트 이름. 없으면 sheet1 로 간다.
  const workbookXml = await readZipText(bytes, entries, 'xl/workbook.xml')
  let sheetName = 'Sheet1'
  if (workbookXml) {
    const document = parser.parseFromString(workbookXml, 'application/xml')
    sheetName = document.getElementsByTagName('sheet')[0]?.getAttribute('name') || sheetName
  }

  const sheetEntry = entries.find((item) => /^xl\/worksheets\/sheet\d+\.xml$/.test(item.name))
  if (!sheetEntry) throw new Error('엑셀에서 시트를 찾지 못했어요.')
  const sheetXml = await readZipText(bytes, entries, sheetEntry.name)
  const document = parser.parseFromString(sheetXml, 'application/xml')

  const grid: string[][] = []
  let width = 0
  for (const row of [...document.getElementsByTagName('row')].slice(0, maxRows)) {
    const cells = [...row.getElementsByTagName('c')]
    const values: string[] = []
    for (const cell of cells) {
      const address = cellAddress(cell.getAttribute('r') || '')
      const type = cell.getAttribute('t')
      const rawValue = cell.getElementsByTagName('v')[0]?.textContent
        ?? [...cell.getElementsByTagName('t')].map((node) => node.textContent || '').join('')
      let text = rawValue || ''
      if (type === 's') text = shared[Number(rawValue)] ?? ''
      const column = address ? address.column : values.length
      while (values.length < column) values.push('')
      values[column] = text
    }
    width = Math.max(width, values.length)
    grid.push(values)
  }
  const csv = grid
    .map((values) => Array.from({ length: width }, (_, index) => csvCell(values[index] ?? '')).join(','))
    .join('\n')
  return { csv, sheetName }
}

/* ── 표 미리보기 ───────────────────────────────────────────── */

/** CSV 문자열의 열 이름과 행 수. 브라우저에서만 계산하고 원문은 필요할 때만 보낸다. */
export function csvShape(text: string) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((line) => line.trim().length > 0)
  if (!lines.length) return { headers: [] as string[], rowCount: 0 }
  const headers = splitCsvLine(lines[0]).map((item) => item.trim()).filter(Boolean)
  return { headers, rowCount: Math.max(0, lines.length - 1) }
}

function splitCsvLine(line: string) {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (quoted) {
      if (character === '"' && line[index + 1] === '"') { cell += '"'; index += 1 }
      else if (character === '"') quoted = false
      else cell += character
    } else if (character === '"') quoted = true
    else if (character === ',') { cells.push(cell); cell = '' }
    else cell += character
  }
  cells.push(cell)
  return cells
}
