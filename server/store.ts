// 원장 저장소.
//
// 로컬은 지금까지처럼 data/db.json 파일을 쓴다.
// Vercel처럼 인스턴스가 여러 개 뜨는 환경에서는 파일이 인스턴스마다 따로 존재해서
// "여러 사람이 같이 쓰는" 서비스가 성립하지 않는다. 그래서 STATE_STORE=supabase 이면
// Supabase Postgres의 app_state 한 행에 원장을 두고,
//   ① 쓰기 요청은 행 잠금(compare-and-set)으로 전역 직렬화하고
//   ② 잠금 안에서 항상 최신 상태를 다시 읽은 뒤 실행한다.
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Database } from './types.ts'

export type StateSnapshot = { data: Database; version: number }

export interface StateStore {
  readonly kind: 'file' | 'supabase'
  /** 저장된 원장. 아직 없으면 undefined. */
  read(): Promise<StateSnapshot | undefined>
  /** 최신 버전 번호만 확인한다. 조회 요청이 매번 원장 전체를 내려받지 않게 한다. */
  version(): Promise<number>
  /** expectedVersion 이 그대로일 때만 저장한다. 다르면 undefined 를 돌려준다. */
  write(data: Database, expectedVersion: number): Promise<number | undefined>
  /** 전역 쓰기 잠금. 파일 저장소는 단일 프로세스라 항상 성공한다. */
  acquire(owner: string): Promise<boolean>
  release(owner: string): Promise<void>
}

export class FileStateStore implements StateStore {
  readonly kind = 'file' as const
  #queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly dbPath: string) {}

  async read() {
    try {
      const raw = await fs.readFile(this.dbPath, 'utf8')
      return { data: JSON.parse(raw) as Database, version: 0 }
    } catch {
      return undefined
    }
  }

  async version() { return 0 }

  write(data: Database) {
    // 부분 저장된 파일이 남지 않도록 임시 파일에 쓴 뒤 원자적으로 교체한다.
    this.#queue = this.#queue.then(async () => {
      await fs.mkdir(path.dirname(this.dbPath), { recursive: true })
      const temp = `${this.dbPath}.tmp`
      await fs.writeFile(temp, JSON.stringify(data, null, 2), 'utf8')
      await fs.rename(temp, this.dbPath)
    })
    return this.#queue.then(() => 0)
  }

  async acquire() { return true }
  async release() { /* 단일 프로세스에는 잠금이 필요 없다. */ }
}

const LOCK_STALE_MS = 15_000

export class SupabaseStateStore implements StateStore {
  readonly kind = 'supabase' as const
  readonly #base: string
  readonly #key: string
  readonly #row: string

  constructor(url: string, serviceKey: string, rowId = 'meoktu') {
    this.#base = `${url.replace(/\/$/, '')}/rest/v1/app_state`
    this.#key = serviceKey
    this.#row = rowId
  }

  async #request(query: string, options: RequestInit = {}) {
    const response = await fetch(`${this.#base}${query}`, {
      ...options,
      headers: {
        apikey: this.#key,
        Authorization: `Bearer ${this.#key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
        ...options.headers,
      },
      signal: AbortSignal.timeout(20_000),
    })
    const body = await response.json().catch(() => []) as any
    if (!response.ok) {
      throw new Error(`app_state ${response.status}: ${body?.message || body?.hint || JSON.stringify(body).slice(0, 200)}`)
    }
    return Array.isArray(body) ? body : [body]
  }

  async read() {
    const rows = await this.#request(`?id=eq.${this.#row}&select=version,data`)
    if (!rows.length) return undefined
    return { data: rows[0].data as Database, version: Number(rows[0].version) }
  }

  async version() {
    const rows = await this.#request(`?id=eq.${this.#row}&select=version`)
    return rows.length ? Number(rows[0].version) : -1
  }

  /** 첫 기동에서 원장이 비어 있을 때만 시드를 심는다. 이미 있으면 아무것도 하지 않는다. */
  async seed(data: Database) {
    const response = await fetch(this.#base, {
      method: 'POST',
      headers: {
        apikey: this.#key,
        Authorization: `Bearer ${this.#key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=representation',
      },
      body: JSON.stringify({ id: this.#row, version: 1, data }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error(`app_state seed ${response.status}: ${(await response.text()).slice(0, 200)}`)
    return this.read()
  }

  async write(data: Database, expectedVersion: number) {
    // version 이 그대로일 때만 갱신된다. 다른 인스턴스가 먼저 썼다면 0행이 돌아온다.
    const rows = await this.#request(`?id=eq.${this.#row}&version=eq.${expectedVersion}&select=version`, {
      method: 'PATCH',
      body: JSON.stringify({ version: expectedVersion + 1, data, updated_at: new Date().toISOString() }),
    })
    return rows.length ? Number(rows[0].version) : undefined
  }

  async acquire(owner: string) {
    const stale = new Date(Date.now() - LOCK_STALE_MS).toISOString()
    // 잠금이 비어 있거나, 오래 붙잡힌 채 방치된 경우에만 가져간다(죽은 인스턴스 대비).
    const rows = await this.#request(
      `?id=eq.${this.#row}&or=(lock_owner.is.null,locked_at.lt.${stale})&select=lock_owner`,
      { method: 'PATCH', body: JSON.stringify({ lock_owner: owner, locked_at: new Date().toISOString() }) },
    )
    return rows.length > 0
  }

  async release(owner: string) {
    await this.#request(`?id=eq.${this.#row}&lock_owner=eq.${owner}&select=id`, {
      method: 'PATCH',
      body: JSON.stringify({ lock_owner: null, locked_at: null }),
    }).catch(() => undefined)
  }
}

export const APP_STATE_SQL = `
create table if not exists public.app_state (
  id text primary key,
  version bigint not null default 0,
  data jsonb not null,
  lock_owner text,
  locked_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.app_state enable row level security;
revoke all on public.app_state from anon, authenticated;
comment on table public.app_state is '먹투 서비스 원장. service_role 로만 접근하며 브라우저에 노출하지 않는다.';
`
