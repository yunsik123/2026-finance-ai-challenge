/**
 * 생성형 자격증명 공급자 — Google Vertex AI 전용.
 *
 * 예전에는 OPENAI_API_KEY 라는 "고정 문자열" 하나로 끝났다.
 * Vertex AI 는 API 키가 아니라 수명이 1시간인 OAuth 액세스 토큰을 쓴다.
 * 그래서 고정 문자열이던 자리를 "호출 직전에 물어보는 함수"로 바꿔야 하고,
 * 그 차이를 이 파일이 전부 흡수한다. 호출부는 await aiToken() 만 하면 된다.
 *
 * 토큰을 얻는 경로는 세 가지이고 위에서부터 되는 것을 쓴다.
 *   ① 메타데이터 서버 — Cloud Run·GCE 안에서 서비스 계정이 자동으로 붙는다.
 *      배포본에는 키 파일이 아예 없으므로 유출될 자격증명 자체가 존재하지 않는다.
 *   ② GOOGLE_APPLICATION_CREDENTIALS — 서비스 계정 키 파일. JWT 를 서명해 교환한다.
 *   ③ ADC 사용자 자격증명 — 로컬에서 gcloud auth application-default login 한 결과.
 *
 * 셋 다 없으면 aiReady() 가 false 가 되고 서버는 규칙 엔진 폴백으로만 답한다.
 * 조용히 다른 유료 공급자로 넘어가는 경로는 의도적으로 두지 않았다.
 */
import { createSign } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const METADATA_HOST = process.env.GCE_METADATA_HOST || 'metadata.google.internal'
/** 토큰이 실제로 만료되기 전에 미리 새로 받는다. 경계에서 401 이 나는 것을 막는다. */
const REFRESH_MARGIN_MS = 5 * 60_000

/**
 * 기본 모델. Vertex 의 OpenAI 호환 경로는 'google/' 접두사를 요구한다.
 * gemini-3-flash-preview 는 응답이 빠르면서 JSON 형식 강제와 이미지 입력을 모두 받는다.
 * (상담·요약·영수증 판독이 전부 이 한 모델로 처리된다.)
 */
const DEFAULT_CHAT_MODEL = 'gemini-3-flash-preview'
/** 근거를 길게 엮어야 하는 자리에서 쓸 모델. 필요하면 pro 계열로 올린다. */
const DEFAULT_REASONING_MODEL = 'gemini-3-flash-preview'

export type AiProvider = 'vertex' | 'off'

const trimmed = (value: unknown) => String(value ?? '').trim()

/**
 * 환경변수는 반드시 "호출 시점"에 읽는다.
 * ES 모듈은 import 가 먼저 평가되므로, 모듈 로드 중에 process.env 를 읽으면
 * index.ts 가 loadEnvFile() 로 .env 를 넣기 전이라 값이 전부 비어 있다.
 */
const vertexLocation = () => trimmed(process.env.VERTEX_LOCATION) || 'global'

/**
 * Vertex 의 OpenAI 호환 엔드포인트.
 * chat/completions 규격을 그대로 받으므로 기존 호출부를 고칠 필요가 없다.
 * (json_object 응답 형식과 image_url 멀티모달 입력까지 그대로 통한다.)
 *
 * 리전 엔드포인트는 프로젝트·모델 조합에 따라 404 가 난다. global 은 최신 Gemini 가
 * 항상 올라와 있으므로 기본값을 global 로 둔다. 바꾸려면 VERTEX_LOCATION 을 준다.
 */
function vertexEndpoint(project: string) {
  const location = vertexLocation()
  const host = location === 'global'
    ? 'https://aiplatform.googleapis.com'
    : `https://${location}-aiplatform.googleapis.com`
  return `${host}/v1/projects/${project}/locations/${location}/endpoints/openapi/chat/completions`
}

let cachedProject = ''
let cachedToken: { value: string; expiresAt: number } | undefined
let credentialKind: 'metadata' | 'service-account' | 'user' | undefined
/** 자격증명 탐색은 한 번만 한다. 여러 요청이 동시에 들어와도 중복 조회하지 않는다. */
let discovery: Promise<boolean> | undefined

const base64url = (input: Buffer | string) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function readJsonFile(file: string) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, any>
  } catch {
    return undefined
  }
}

/** Cloud Run·GCE 안에서만 응답한다. 밖에서는 즉시 실패하므로 타임아웃을 짧게 둔다. */
async function metadataToken() {
  const response = await fetch(
    `http://${METADATA_HOST}/computeMetadata/v1/instance/service-accounts/default/token`,
    { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(3_000) },
  )
  if (!response.ok) throw new Error(`metadata token ${response.status}`)
  const body = await response.json() as { access_token: string; expires_in: number }
  return { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 }
}

async function metadataProject() {
  const response = await fetch(`http://${METADATA_HOST}/computeMetadata/v1/project/project-id`, {
    headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(3_000),
  })
  return response.ok ? (await response.text()).trim() : ''
}

const serviceAccountPath = () => trimmed(process.env.GOOGLE_APPLICATION_CREDENTIALS) || undefined

/** gcloud auth application-default login 이 남기는 사용자 자격증명 경로. */
function adcPath() {
  if (process.env.CLOUDSDK_CONFIG) return path.join(process.env.CLOUDSDK_CONFIG, 'application_default_credentials.json')
  return path.join(os.homedir(), '.config', 'gcloud', 'application_default_credentials.json')
}

/** 서비스 계정: 자기 키로 서명한 JWT 를 액세스 토큰으로 교환한다. */
async function serviceAccountToken(credentials: Record<string, any>) {
  const issued = Math.floor(Date.now() / 1000)
  const claim = {
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: TOKEN_ENDPOINT,
    iat: issued,
    exp: issued + 3600,
  }
  const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(JSON.stringify(claim))}`
  const signer = createSign('RSA-SHA256')
  signer.update(unsigned)
  const jwt = `${unsigned}.${base64url(signer.sign(credentials.private_key))}`

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`service account token ${response.status}: ${(await response.text()).slice(0, 200)}`)
  const body = await response.json() as { access_token: string; expires_in: number }
  return { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 }
}

/** 사용자 ADC: 저장된 refresh_token 으로 액세스 토큰을 새로 받는다. */
async function userToken(credentials: Record<string, any>) {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      refresh_token: credentials.refresh_token,
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`ADC token ${response.status}: ${(await response.text()).slice(0, 200)}`)
  const body = await response.json() as { access_token: string; expires_in: number }
  return { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 }
}

/**
 * 쓸 수 있는 자격증명이 있는지 한 번만 확인하고 종류를 기억한다.
 * 프로젝트 ID 도 이 과정에서 같이 채운다(환경변수에 없으면 자격증명이 알고 있다).
 */
async function discoverCredentials() {
  const saPath = serviceAccountPath()
  if (saPath) {
    const credentials = await readJsonFile(saPath)
    if (credentials?.client_email && credentials?.private_key) {
      credentialKind = 'service-account'
      cachedProject ||= trimmed(credentials.project_id)
      return true
    }
  }

  try {
    await metadataToken()
    credentialKind = 'metadata'
    cachedProject ||= await metadataProject().catch(() => '')
    return true
  } catch { /* GCP 밖이면 여기로 온다. 정상 경로다. */ }

  const adc = await readJsonFile(adcPath())
  if (adc?.refresh_token && adc?.client_id) {
    credentialKind = 'user'
    cachedProject ||= trimmed(adc.quota_project_id)
    return true
  }

  return false
}

async function ensureCredentials() {
  discovery ??= discoverCredentials()
  return discovery
}

async function fetchToken() {
  if (credentialKind === 'metadata') return metadataToken()
  if (credentialKind === 'service-account') {
    const credentials = await readJsonFile(serviceAccountPath()!)
    if (!credentials) throw new Error('service account key file unreadable')
    return serviceAccountToken(credentials)
  }
  const adc = await readJsonFile(adcPath())
  if (!adc) throw new Error('ADC credentials unreadable')
  return userToken(adc)
}

/**
 * 부팅에서 한 번만 부른다. 자격증명 탐색은 메타데이터 서버 조회까지 포함하므로
 * 요청 처리 중이 아니라 기동 시점에 끝내야 첫 요청이 느려지지 않는다.
 */
export async function initAiProvider(): Promise<AiProvider> {
  // .env 가 이미 로드된 뒤에 불린다. 여기서부터 환경변수를 믿을 수 있다.
  cachedProject = trimmed(process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.VERTEX_PROJECT)
  const hasCredentials = await ensureCredentials()
  if (hasCredentials && cachedProject) return 'vertex'
  if (hasCredentials && !cachedProject) {
    console.warn('Google 자격증명은 찾았지만 프로젝트 ID 가 없습니다. GOOGLE_CLOUD_PROJECT 를 설정하세요.')
  }
  return 'off'
}

let provider: AiProvider = 'off'
export function setAiProvider(next: AiProvider) { provider = next }
export function aiProvider() { return provider }
export function aiReady() { return provider === 'vertex' }

/** 지금 자격증명이 어디서 왔는지. 진단용이며 값 자체는 절대 내보내지 않는다. */
export function aiCredentialSource() {
  return provider === 'vertex' ? `google-${credentialKind ?? 'unknown'}` : 'none'
}

export function aiProject() { return cachedProject }

export function aiEndpoint() {
  return provider === 'vertex' ? vertexEndpoint(cachedProject) : ''
}

/**
 * 호출 직전에 부른다. 만료가 가까우면 새로 받고, 아니면 캐시를 준다.
 * 여러 요청이 동시에 만료를 만나도 각자 새로 받을 뿐 잘못된 토큰을 쓰지는 않는다.
 */
export async function aiToken() {
  if (provider !== 'vertex') return ''
  if (cachedToken && cachedToken.expiresAt - REFRESH_MARGIN_MS > Date.now()) return cachedToken.value
  cachedToken = await fetchToken()
  return cachedToken.value
}

/**
 * 모델 이름을 Vertex 규격으로 맞춘다.
 * 예전 .env 에 남아 있는 gpt-* 값은 무시하고 기본 Gemini 로 되돌린다.
 * 그러지 않으면 예전 설정을 그대로 둔 배포가 조용히 404 를 맞는다.
 */
function vertexModel(requested: string, fallback: string) {
  const name = requested && !/^gpt[-.]?/i.test(requested) ? requested : fallback
  return name.startsWith('google/') ? name : `google/${name}`
}

export function aiChatModel() {
  return vertexModel(trimmed(process.env.VERTEX_CHAT_MODEL || process.env.AI_MODEL), DEFAULT_CHAT_MODEL)
}

/** 상담·심사요약처럼 근거를 길게 엮어야 하는 자리. */
export function aiReasoningModel() {
  return vertexModel(trimmed(process.env.VERTEX_REASONING_MODEL || process.env.AI_REASONING_MODEL), DEFAULT_REASONING_MODEL)
}

/** 영수증·증빙 판독. 이미지 입력을 받는 모델이어야 한다. */
export function aiOcrModel() {
  return vertexModel(trimmed(process.env.VERTEX_OCR_MODEL || process.env.AI_OCR_MODEL), DEFAULT_CHAT_MODEL)
}

/**
 * Gemini 3 는 답을 쓰기 전에 "생각"에 토큰을 쓰고, 그 토큰도 max_tokens 예산에서 나간다.
 * 예산을 그대로 두면 생각만 하다 본문이 잘려 JSON 파싱이 실패한다.
 * (실제로 1400 예산에서 932 를 생각에 써서 리포트 JSON 이 중간에 끊겼다.)
 *
 * 그래서 구조화 응답에서는 두 가지를 같이 건다.
 *   · reasoning_effort=low — 생각을 짧게 끊는다. 정확도가 필요한 판단은 규칙 엔진이 하고
 *     생성형은 문장을 다듬는 역할이라 낮춰도 품질이 떨어지지 않는다.
 *   · 예산 상향 — 그래도 남는 생각 토큰 때문에 본문이 잘리지 않게 여유를 준다.
 */
export function aiJsonExtras(): Record<string, unknown> {
  if (provider !== 'vertex') return {}
  return {
    // 생각 토큰을 하드 캡으로 묶는다. reasoning_effort=low 만으로는 부족했다.
    // 실제로 경영 리포트 프롬프트에서 2,495 토큰을 생각에 써서 본문이 105 토큰만 남았다.
    extra_body: { google: { thinking_config: { thinking_budget: Number(process.env.VERTEX_THINKING_BUDGET || 512) } } },
  }
}

export function aiTokenBudget(requested: number) {
  // 캡을 걸어도 생각 토큰은 예산에서 나간다. 캡의 두 배 정도를 여유로 얹는다.
  return provider === 'vertex' ? requested + 2000 : requested
}

/** 화면·로그·응답에 쓸 표기. */
export function aiProviderLabel() {
  return provider === 'vertex' ? 'google-vertex-ai' : 'off'
}
