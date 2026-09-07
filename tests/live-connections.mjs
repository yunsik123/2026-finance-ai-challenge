// Read-only diagnostics. Never prints credentials or individual customer records.
import { loadEnvFile } from 'node:process'
import { writeFile } from 'node:fs/promises'
import pg from 'pg'
import neo4j from 'neo4j-driver'

for (const file of ['.env.local', '.env.development.local', '.env']) {
  try { loadEnvFile(file) } catch (error) { if (error.code !== 'ENOENT') throw error }
}
const result = { at: new Date().toISOString(), mode: 'read-only' }
const connectionUrl = new URL(process.env.DATABASE_URL)
if (process.env.AUDIT_TUNNELS === '1') {
  connectionUrl.hostname = '127.0.0.1'; connectionUrl.port = process.env.AUDIT_PG_PORT || '15432'
  connectionUrl.searchParams.set('sslmode', 'disable')
}
const ssl = connectionUrl.searchParams.get('sslmode') === 'disable' ? undefined : { rejectUnauthorized: false }
connectionUrl.searchParams.delete('sslmode')
const client = new pg.Client({ connectionString: connectionUrl.toString(), ssl,
  connectionTimeoutMillis: 8000, statement_timeout: 10000, application_name: 'meoktu-readonly-audit' })
try {
  await client.connect()
  await client.query('BEGIN READ ONLY')
  const { rows: [settings] } = await client.query(`select current_setting('max_connections')::int as max_connections,
    (select count(*)::int from pg_stat_activity) as connections,
    (select count(*)::int from pg_stat_activity where wait_event_type = 'Lock') as lock_waiters`)
  const { rows: [snapshot] } = await client.query('select meoktu.read_ledger() as snapshot')
  const data = snapshot.snapshot.data
  const { rows: functions } = await client.query(`select proname as name, pg_get_functiondef(p.oid) as definition
    from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='meoktu'
    and proname in ('export_ledger','save_ledger','import_ledger','lock_steal_after')`)
  const { rows: tables } = await client.query("select tablename, rowsecurity from pg_tables where schemaname='meoktu'")
  result.postgres = { connected: true, version: snapshot.snapshot.version, settings,
    counts: Object.fromEntries(Object.entries(data).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, value.length])),
    documentsPersisted: Object.hasOwn(data, 'documents'), tables,
    functions: functions.map(({ name, definition }) => ({ name, handlesDocuments: /owner_documents|'documents'/.test(definition) })),
    invariants: {
      nonnegativeCash: data.users.every(u => Number.isFinite(u.cash) && u.cash >= 0),
      nonnegativePositions: data.positions.every(p => Number.isFinite(p.amount) && p.amount >= 0),
      validOrderRemaining: data.orders.every(o => o.remaining >= 0 && o.remaining <= o.originalAmount),
      uniqueCouponIds: new Set(data.coupons.map(c => c.id)).size === data.coupons.length,
    } }
  await client.query('ROLLBACK')
} catch (error) { result.postgres = { connected: false, error: error.code || error.name } }
finally { await client.end().catch(() => {}) }

const driver = neo4j.driver(process.env.AUDIT_TUNNELS === '1' ? 'bolt://127.0.0.1:17687' : process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USER || 'neo4j', process.env.NEO4J_PASSWORD),
  { connectionAcquisitionTimeout: 8000, connectionTimeout: 8000, maxTransactionRetryTime: 0 })
const session = driver.session({ database: process.env.NEO4J_DATABASE || 'neo4j', defaultAccessMode: neo4j.session.READ })
try {
  result.neo4j = await session.executeRead(async tx => {
    const nodes = await tx.run('MATCH (n) RETURN count(n) AS count')
    const edges = await tx.run('MATCH ()-[r]->() RETURN count(r) AS count')
    const orphans = await tx.run('MATCH (n:Knowledge) WHERE NOT (n)--() RETURN count(n) AS count')
    return { connected: true, nodes: nodes.records[0].get('count').toNumber(),
      edges: edges.records[0].get('count').toNumber(), orphans: orphans.records[0].get('count').toNumber() }
  }, { timeout: 10000 })
} catch (error) { result.neo4j = { connected: false, error: error.code || error.name } }
finally { await session.close(); await driver.close() }
console.log(JSON.stringify(result, null, 2))
if (process.env.AUDIT_OUTPUT) await writeFile(process.env.AUDIT_OUTPUT, JSON.stringify(result, null, 2) + '\n')
if (!result.postgres.connected || !result.neo4j.connected || Object.values(result.postgres.invariants || {}).includes(false)) process.exitCode = 1
