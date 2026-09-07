import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { LedgerContext } from '../server/ledger-context.ts'
import { FileStateStore, type StateStore } from '../server/store.ts'
import type { Database } from '../server/types.ts'

const data = (cash = 0) => ({ users: [{ id: 'test', cash }] } as Database)
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
class MemoryStore implements StateStore {
  readonly kind = 'postgres' as const
  snapshot = { data: data(), version: 0 }
  locked = false
  failRelease = false
  failWrite = false
  async read() { return structuredClone(this.snapshot) }
  async version() { return this.snapshot.version }
  async acquire() { if (this.locked) return false; this.locked = true; return true }
  async release() { this.locked = false; if (this.failRelease) { this.failRelease = false; throw new Error('release failed') } }
  async write(value: Database, version: number) {
    if (this.failWrite) throw new Error('write failed')
    if (version !== this.snapshot.version) return undefined
    this.snapshot = { data: structuredClone(value), version: version + 1 }
    return this.snapshot.version
  }
}
const setup = (wait = 100, queue = 128) => {
  const store = new MemoryStore()
  const ledger = new LedgerContext(store, wait, queue)
  ledger.data = data(); ledger.version = 0
  return { store, ledger }
}

test('100 concurrent writes preserve every increment', async () => {
  const { store, ledger } = setup(2000)
  await Promise.all(Array.from({ length: 100 }, () => ledger.run(true, async () => {
    const before = ledger.data.users[0].cash
    await Promise.resolve()
    ledger.data.users[0].cash = before + 1
    await ledger.save()
  })))
  assert.equal(store.snapshot.data.users[0].cash, 100)
  assert.equal(store.snapshot.version, 100)
})
test('reads cannot publish private mutations', async () => {
  const { store, ledger } = setup()
  await ledger.run(false, async () => { ledger.data.users[0].cash = 99; await ledger.save() })
  assert.equal(store.snapshot.data.users[0].cash, 0)
  assert.equal(ledger.data.users[0].cash, 0)
})
test('an in-flight read retains its snapshot when another request writes', async () => {
  const { ledger } = setup()
  const entered = deferred(), updated = deferred()
  const reader = ledger.run(false, async () => {
    entered.resolve(); await updated.promise
    assert.equal(ledger.data.users[0].cash, 0)
  })
  await entered.promise
  await ledger.run(true, async () => { ledger.data.users[0].cash = 3; await ledger.save() })
  updated.resolve(); await reader
  assert.equal(ledger.data.users[0].cash, 3)
})
test('forced refresh updates an older context even when the cache is current', async () => {
  const { ledger } = setup()
  const entered = deferred(), updated = deferred()
  const reader = ledger.run(false, async () => {
    entered.resolve(); await updated.promise
    await ledger.refresh(true)
    assert.equal(ledger.data.users[0].cash, 7)
    assert.equal(ledger.version, 1)
  })
  await entered.promise
  await ledger.run(true, async () => { ledger.data.users[0].cash = 7; await ledger.save() })
  updated.resolve(); await reader
})
test('a failed save does not publish its data and the next write recovers', async () => {
  const { store, ledger } = setup()
  store.failWrite = true
  await assert.rejects(ledger.run(true, async () => { ledger.data.users[0].cash = 9; await ledger.save() }))
  assert.equal(ledger.data.users[0].cash, 0)
  store.failWrite = false
  await ledger.run(true, async () => { ledger.data.users[0].cash = 2; await ledger.save() })
  assert.equal(store.snapshot.data.users[0].cash, 2)
})
test('optimistic version conflicts return 409 without overwriting the winner', async () => {
  const { store, ledger } = setup()
  await assert.rejects(ledger.run(true, async () => {
    store.snapshot = { data: data(8), version: 1 }
    ledger.data.users[0].cash = 4; await ledger.save()
  }), { status: 409 })
  assert.equal(store.snapshot.data.users[0].cash, 8)
})
test('release failure still frees the local queue', async () => {
  const { store, ledger } = setup(30)
  store.failRelease = true
  await assert.rejects(ledger.run(true, () => {}), /release failed/)
  await ledger.run(true, async () => { await ledger.save() })
})
test('overflow is rejected with 503 and pending writes complete', async () => {
  const { ledger } = setup(1000, 1)
  const started = deferred(), unblock = deferred()
  const first = ledger.run(true, async () => { started.resolve(); await unblock.promise })
  await started.promise
  const second = ledger.run(true, () => {})
  await assert.rejects(ledger.run(true, () => {}), { status: 503 })
  unblock.resolve(); await Promise.all([first, second])
})
test('timed-out waiter is removed and later writes can proceed', async () => {
  const { ledger } = setup(20)
  const started = deferred(), unblock = deferred()
  const first = ledger.run(true, async () => { started.resolve(); await unblock.promise })
  await started.promise
  await assert.rejects(ledger.run(true, () => {}), { status: 503 })
  unblock.resolve(); await first
  await ledger.run(true, () => {})
})
test('cancelled requests cannot start new database writes', async () => {
  const { ledger } = setup()
  await ledger.run(true, async () => { ledger.cancel(); await assert.rejects(ledger.save(), { status: 503 }) })
})
test('a disconnected request holds its lock until in-flight SQL settles', async () => {
  const { ledger } = setup()
  const unblock = deferred(), started = deferred()
  let secondStarted = false
  const first = ledger.run(true, () => { void ledger.track(() => unblock.promise); started.resolve() })
  await started.promise
  const second = ledger.run(true, () => { secondStarted = true })
  await Promise.resolve(); assert.equal(secondStarted, false)
  unblock.resolve(); await Promise.all([first, second])
})
test('nested writes reuse the owning lock', async () => {
  const { ledger } = setup()
  await ledger.run(true, () => ledger.run(true, async () => { await ledger.save() }))
})

test('file writes recover after a transient filesystem error', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'meoktu-file-recovery-'))
  try {
    const parent = path.join(dir, 'parent')
    await writeFile(parent, 'temporarily blocks directory creation')
    const store = new FileStateStore(path.join(parent, 'db.json'))
    await assert.rejects(store.write(data(1)))
    await rm(parent); await mkdir(parent)
    await store.write(data(2))
    assert.equal((await store.read())?.data.users[0].cash, 2)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
test('corrupt existing files fail loudly instead of triggering seed replacement', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'meoktu-file-corruption-'))
  try {
    const file = path.join(dir, 'db.json')
    await writeFile(file, '{broken')
    await assert.rejects(new FileStateStore(file).read())
    assert.equal(await readFile(file, 'utf8'), '{broken')
    assert.equal(await new FileStateStore(path.join(dir, 'absent.json')).read(), undefined)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
test('file write captures its snapshot before queueing', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'meoktu-file-snapshot-'))
  try {
    const store = new FileStateStore(path.join(dir, 'db.json'))
    const value = data(1)
    const saving = store.write(value)
    value.users[0].cash = 999
    await saving
    assert.equal((await store.read())?.data.users[0].cash, 1)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
