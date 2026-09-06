export const TOKEN_KEY = 'meoktu-token'

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
    this.name = 'ApiError'
  }
}

export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = (token: string) => localStorage.setItem(TOKEN_KEY, token)
export const clearToken = () => localStorage.removeItem(TOKEN_KEY)

export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers = new Headers(options.headers)
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(url, {
    ...options,
    headers,
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000),
  })
  if (response.status === 204) return undefined as T
  const result = await response.json().catch(() => null) as T & { error?: string } | null
  if (!response.ok) throw new ApiError(typeof result?.error === 'string' ? result.error : '요청을 처리하지 못했어요.', response.status)
  if (result === null) throw new ApiError('서버 응답을 읽지 못했어요. 잠시 후 다시 시도해주세요.', response.status)
  return result
}
