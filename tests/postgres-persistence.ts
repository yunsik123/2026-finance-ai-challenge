import assert from 'node:assert/strict'
import pg from 'pg'

assert.equal(process.env.MEOKTU_ISOLATED_AUDIT, '1')
const url = new URL(process.env.DATABASE_URL!)
assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '15439')
assert(/^\/meoktu_audit_[a-f0-9]+$/.test(url.pathname))
const client = new pg.Client({ connectionString: url.toString(), statement_timeout: 10000 })
await client.connect()
let checks = 0
const eq = (actual: unknown, expected: unknown, label: string) => { assert.deepEqual(actual, expected, label); checks++ }
try {
  await client.query('BEGIN')
  const { rows: [row] } = await client.query('select meoktu.read_ledger() as snapshot')
  const data = row.snapshot.data
  const fund = data.funds.find((item: any) => item.id === 'f-sobok')
  const coupon = data.coupons.find((item: any) => item.id === 'c-1')
  const listing = data.couponListings.find((item: any) => item.id === 'cl-1')
  const fundChanges = { goal: fund.goal + 100000, maxDiscount: 35, minIssueDiscount: 12,
    dailyRatePer100k: .7, salesBonus: 11, earlyBonus: 1.7, purpose: '저장 왕복 검증', riskLevel: '주의', endsAt: '2030-01-01T00:00:00.000Z' }
  const couponChanges = { title: '검증 쿠폰', discount: 18, maxDiscountWon: 2000, status: 'redeeming',
    redeemCode: 'AUDIT123', redeemRequestedAt: '2026-09-07T01:00:00.000Z', usedAtRestaurantId: coupon.restaurantId,
    usedAt: '2026-09-07T01:01:00.000Z', expiresAt: '2030-01-01T00:00:00.000Z' }
  const listingChanges = { wantedCategories: ['카페'], wantedRegions: ['서울'], minDiscount: 12, autoAccept: false,
    note: '교환 조건 보존', expiresAt: '2030-01-01T00:00:00.000Z' }
  Object.assign(fund, fundChanges); Object.assign(coupon, couponChanges); Object.assign(listing, listingChanges)
  data.documents.push({ id: 'audit-doc', userId: 'u-owner', filename: '검증.csv', fileHash: 'audit-unique-hash',
    byteSize: 42, mimeType: 'text/csv', sourceId: 'account', classification: { sourceId: 'account', confidence: .9, basis: 'headers' },
    reclassified: true, fields: [{ key: 'total', value: 100, correctedValue: 110, confirmed: true }],
    correctionHistory: [{ field: 'total', before: 100, after: 110 }], rowCount: 2, headers: ['입금액'],
    status: 'confirmed', usedInApplicationIds: [], createdAt: '2026-09-07T00:00:00.000Z', updatedAt: '2026-09-07T01:00:00.000Z' })
  const { rows: [saved] } = await client.query('select meoktu.save_ledger($1::jsonb,$2) as version', [JSON.stringify(data), row.snapshot.version])
  eq(Number(saved.version), Number(row.snapshot.version) + 1, 'CAS advances version')
  const { rows: [read] } = await client.query('select meoktu.read_ledger() as snapshot')
  for (const [collection, id, expected] of [['funds', fund.id, fundChanges], ['coupons', coupon.id, couponChanges], ['couponListings', listing.id, listingChanges]] as const) {
    const actual = read.snapshot.data[collection].find((item: any) => item.id === id)
    for (const [key, value] of Object.entries(expected)) eq(actual[key], value, `${collection}.${key} persists`)
  }
  const document = read.snapshot.data.documents.find((item: any) => item.id === 'audit-doc')
  for (const key of ['fields', 'correctionHistory', 'sourceId', 'status', 'reclassified', 'headers']) {
    eq(document[key], data.documents.at(-1)[key], `document.${key} persists`)
  }
  const consent = { id: 'audit-consent', userId: 'u-investor', context: 'invest', documentIds: ['terms'],
    version: 'test-v1', resourceType: 'fund', resourceId: fund.id, amount: 1000, riskAcknowledged: true, agreedAt: new Date().toISOString() }
  const args = ['u-investor', fund.id, 1000, 'invest', JSON.stringify(consent)]
  await client.query('select meoktu.consented_fund_action($1,$2,$3,$4,$5::jsonb)', args)
  eq((await client.query("select count(*)::int as count from meoktu.legal_consents where id='audit-consent'")).rows[0].count, 1, 'trade consent persists')
  const cash = (await client.query("select cash from meoktu.profiles where id='u-investor'")).rows[0].cash
  await client.query('SAVEPOINT duplicate_consent')
  await assert.rejects(client.query('select meoktu.consented_fund_action($1,$2,$3,$4,$5::jsonb)', args)); checks++
  await client.query('ROLLBACK TO SAVEPOINT duplicate_consent')
  eq((await client.query("select cash from meoktu.profiles where id='u-investor'")).rows[0].cash, cash, 'consent insert failure rolls back money movement')
  console.log(`PASS: PostgreSQL persistence and atomic consent ${checks}/${checks}`)
} finally { await client.query('ROLLBACK'); await client.end() }
