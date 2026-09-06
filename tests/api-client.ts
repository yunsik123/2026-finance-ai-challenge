import assert from 'node:assert/strict'
import { api, ApiError, setToken, clearToken } from '../src/lib/api.ts'

const values = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
} })
const originalFetch = globalThis.fetch
try {
  setToken('test-session')
  globalThis.fetch = async (_url, options) => {
    const headers = new Headers(options?.headers)
    assert.equal(headers.get('Authorization'), 'Bearer test-session')
    assert.equal(headers.get('X-Request'), 'test')
    assert(options?.signal)
    return Response.json({ ok: true })
  }
  assert.deepEqual(await api('/api/example', { headers: new Headers({ 'X-Request': 'test' }) }), { ok: true })
  globalThis.fetch = async () => Response.json({ error: '로그인이 필요해요.' }, { status: 401 })
  await assert.rejects(api('/api/me'), (error: unknown) => error instanceof ApiError && error.status === 401)
  globalThis.fetch = async () => new Response('<html>Bad Gateway</html>', { status: 502 })
  await assert.rejects(api('/api/me'), (error: unknown) => error instanceof ApiError && error.status === 502)
  globalThis.fetch = async () => new Response('<html>SPA fallback</html>', { status: 200 })
  await assert.rejects(api('/api/public'), /서버 응답을 읽지 못했어요/)
  globalThis.fetch = async () => new Response(null, { status: 204 })
  assert.equal(await api('/api/example'), undefined)
  clearToken()
  globalThis.fetch = async (_url, options) => {
    const headers = new Headers(options?.headers)
    assert.equal(headers.get('Authorization'), null)
    assert.equal(headers.get('Content-Type'), null)
    return Response.json({ uploaded: true })
  }
  assert.deepEqual(await api('/api/upload', { method: 'POST', body: new FormData() }), { uploaded: true })
  console.log('PASS: API headers, HTTP status, invalid JSON, empty response, multipart body')
} finally {
  globalThis.fetch = originalFetch
}
