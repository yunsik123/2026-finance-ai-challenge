import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { Database } from './types.ts'
import type { StateSnapshot, StateStore } from './store.ts'

type Context = StateSnapshot & { owner?: string; cancelled?: boolean; pending: Set<Promise<unknown>> }
const busy = () => Object.assign(new Error('요청이 몰리고 있어요. 잠시 후 다시 시도해주세요.'), { status: 503 })

/** Each request owns its snapshot. Awaiting a DB/AI call must never let another
 * request replace the ledger underneath its user/position object references. */
export class LedgerContext {
  readonly #contexts = new AsyncLocalStorage<Context>()
  #cached: StateSnapshot = { data: undefined as unknown as Database, version: 0 }
  #refresh?: Promise<void>
  #checkedAt = 0
  #writing = false
  #waiters: Array<() => void> = []

  constructor(readonly store: StateStore, readonly waitMs = 9000, readonly maxQueue = 128) {}
  get data() { return (this.#contexts.getStore() ?? this.#cached).data }
  set data(data: Database) { (this.#contexts.getStore() ?? this.#cached).data = data }
  get version() { return (this.#contexts.getStore() ?? this.#cached).version }
  set version(version: number) { (this.#contexts.getStore() ?? this.#cached).version = version }
  get owner() { return this.#contexts.getStore()?.owner }

  async #enter() {
    if (!this.#writing) { this.#writing = true; return }
    if (this.#waiters.length >= this.maxQueue) throw busy()
    await new Promise<void>((resolve, reject) => {
      const ready = () => { clearTimeout(timer); resolve() }
      const timer = setTimeout(() => {
        this.#waiters = this.#waiters.filter(item => item !== ready)
        reject(busy())
      }, this.waitMs)
      this.#waiters.push(ready)
    })
  }
  #leave() {
    const next = this.#waiters.shift()
    if (next) next()
    else this.#writing = false
  }

  #publish(snapshot: StateSnapshot) {
    if (snapshot.version >= this.#cached.version) this.#cached = structuredClone(snapshot)
  }

  async refresh(force = false) {
    if (this.store.kind === 'file') return
    const context = this.#contexts.getStore()
    if (force) {
      // 캐시가 최신이어도 이 요청이 가진 사본은 이전 버전일 수 있다.
      const version = await this.store.version()
      this.#checkedAt = Date.now()
      if (version === this.#cached.version) {
        if (context && context.version !== version) Object.assign(context, structuredClone(this.#cached))
        return
      }
      const snapshot = await this.store.read()
      if (!snapshot) throw new Error('저장된 원장을 읽지 못했어요.')
      if (context) Object.assign(context, snapshot)
      this.#publish(snapshot)
      return
    }
    if (!this.#refresh && Date.now() - this.#checkedAt >= 1500) {
      this.#refresh = (async () => {
        const version = await this.store.version()
        if (version !== this.#cached.version) {
          const snapshot = await this.store.read()
          if (!snapshot) throw new Error('저장된 원장을 읽지 못했어요.')
          this.#publish(snapshot)
        }
        this.#checkedAt = Date.now()
      })().finally(() => { this.#refresh = undefined })
    }
    await this.#refresh
  }

  /** Tracking in-flight SQL also keeps a disconnected request's lock until the
   * actual write settles. Later writes from that request are rejected. */
  async track<T>(operation: () => Promise<T>): Promise<T> {
    const context = this.#contexts.getStore()
    if (context?.cancelled) throw busy()
    const pending = operation()
    context?.pending.add(pending)
    try { return await pending } finally { context?.pending.delete(pending) }
  }

  async save() {
    const context = this.#contexts.getStore()
    // GET-derived coupon accrual/expiry is calculated on a private snapshot.
    if (context && !context.owner) return
    if (!context && this.store.kind !== 'file') return
    const next = await this.track(() => this.store.write(this.data, this.version))
    if (next === undefined) {
      this.#checkedAt = 0
      throw Object.assign(new Error('원장이 다른 요청에서 변경됐어요. 다시 시도해주세요.'), { status: 409 })
    }
    this.version = next
    this.#publish({ data: this.data, version: next })
  }

  cancel() {
    const context = this.#contexts.getStore()
    if (context) context.cancelled = true
  }

  async run<T>(writable: boolean, handler: () => Promise<T> | T): Promise<T> {
    if (writable && this.owner) return handler()
    let owner: string | undefined
    let acquired = false
    if (writable) await this.#enter()
    try {
      if (writable) {
        owner = randomUUID()
        const deadline = Date.now() + this.waitMs
        do {
          acquired = await this.store.acquire(owner)
          if (acquired) break
          await new Promise(resolve => setTimeout(resolve, 120 + Math.random() * 200))
        } while (Date.now() < deadline)
        if (!acquired) throw busy()
      } else await this.refresh()
      const context: Context = { ...structuredClone(this.#cached), owner, pending: new Set() }
      return await this.#contexts.run(context, async () => {
        try {
          if (writable) await this.refresh(true)
          return await handler()
        } finally {
          context.cancelled = true
          await Promise.allSettled([...context.pending])
        }
      })
    } finally {
      try {
        if (owner && acquired) await this.store.release(owner)
      } finally {
        if (writable) this.#leave()
      }
    }
  }
}
