/**
 * Neo4j 지식그래프.
 *
 * 지금까지 그래프는 server/trust.ts 안의 배열이었다. 노드를 문자열 포함으로 점수 매기고
 * 이웃을 한 칸(1홉)만 끌어오는 방식이라, "내가 지금 이래서 → 이 자료가 비어서 → 그래서
 * 이 제도를 못 쓴다"처럼 **두세 칸 건너뛰는 연결**을 답할 수 없었다.
 *
 * 여기서는 같은 그래프를 Neo4j 에 올리고 순회를 DB 에 맡긴다. 달라지는 것은 두 가지다.
 *   ① 다중 홉 — 질문에 걸린 노드에서 2홉까지 따라가 근거를 모은다.
 *   ② 사장님 개인 노드 — 로그인한 사장님의 현재 상태를 그래프에 넣고,
 *      제도 노드와 "자격이 될 수 있다 / 이것 때문에 막혀 있다" 관계로 잇는다.
 *      덕분에 "나 지금 뭐 받을 수 있어?"가 문자열 검색이 아니라 그래프 질의가 된다.
 *
 * 설계 원칙: Neo4j 는 **선택 사항**이다. NEO4J_URI 가 없거나 연결이 끊기면
 * 곧바로 undefined 를 돌려주고 호출부는 기존 인메모리 검색을 그대로 쓴다.
 * 그래프 DB 가 죽었다고 상담이 멈추면 안 된다.
 */
import neo4j, { type Driver } from 'neo4j-driver'
import type { GraphEdge, GraphNode } from './trust.ts'
import type { OwnerSituation, SupportProgram } from './knowledge.ts'

let driver: Driver | undefined
let enabled = false
let lastError = ''

const trimmed = (value: unknown) => String(value ?? '').trim()
const database = () => trimmed(process.env.NEO4J_DATABASE) || 'neo4j'

export function graphDbEnabled() { return enabled }
export function graphDbStatus() {
  return enabled ? 'connected' : (lastError ? `off (${lastError})` : 'off')
}

/**
 * 연결하고 제약·인덱스를 만든다. 실패해도 예외를 올리지 않는다.
 * 부팅이 그래프 DB 때문에 막히면 서비스 전체가 못 뜬다.
 */
export async function initGraphDb() {
  const uri = trimmed(process.env.NEO4J_URI)
  if (!uri) { lastError = 'NEO4J_URI 미설정'; return false }
  try {
    driver = neo4j.driver(uri, neo4j.auth.basic(
      trimmed(process.env.NEO4J_USER) || 'neo4j',
      trimmed(process.env.NEO4J_PASSWORD),
    ), { connectionAcquisitionTimeout: 10_000 })
    await driver.verifyConnectivity()
    // key 는 role 과 id 를 합친 값이다. 같은 id 라도 사장님용·투자자용 설명이 다르다.
    await driver.executeQuery(
      'create constraint knowledge_key if not exists for (n:Knowledge) require n.key is unique',
      {}, { database: database() })
    await driver.executeQuery(
      'create constraint owner_id if not exists for (o:Owner) require o.id is unique',
      {}, { database: database() })
    enabled = true
    lastError = ''
    return true
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error)
    enabled = false
    driver = undefined
    return false
  }
}

export async function closeGraphDb() {
  await driver?.close().catch(() => undefined)
  driver = undefined
  enabled = false
}

/** 질의 한 번. 실패하면 그래프 DB 를 끄고 undefined 를 준다(호출부가 폴백한다). */
async function run<T = any>(cypher: string, params: Record<string, unknown>) {
  if (!driver || !enabled) return undefined
  try {
    const result = await driver.executeQuery(cypher, params, { database: database() })
    return result.records as T[]
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error)
    console.error('Neo4j 질의 실패:', lastError)
    return undefined
  }
}

/** 검색어가 걸릴 자리를 한 문자열로 모아 둔다. Cypher 에서 CONTAINS 로 훑는다. */
function searchText(node: GraphNode) {
  return `${node.label} ${Object.values(node.properties).join(' ')}`.toLocaleLowerCase('ko')
}

/**
 * 정적 지식(절차·규칙·제도·화면지도)을 Neo4j 에 반영한다.
 * MERGE 라서 여러 번 불러도 중복이 생기지 않는다. 부팅 때 한 번 부른다.
 */
export async function syncKnowledge(role: string, graphVersion: string, nodes: GraphNode[], edges: GraphEdge[]) {
  if (!enabled) return false
  const nodeRows = nodes.map((node, index) => ({
    key: `${role}|${node.id}`,
    id: node.id,
    role,
    graphVersion,
    idx: index,
    type: node.type,
    label: node.label,
    source: node.source,
    searchText: searchText(node),
    // Neo4j 속성은 중첩 맵을 담지 못한다. 원래 모양 그대로 되돌리려고 JSON 으로 둔다.
    propsJson: JSON.stringify(node.properties),
  }))
  const edgeRows = edges.map((edge) => ({
    fromKey: `${role}|${edge.from}`,
    toKey: `${role}|${edge.to}`,
    relation: edge.relation,
  }))

  const wrote = await run(`
    unwind $nodes as row
    merge (n:Knowledge {key: row.key})
    set n.id = row.id, n.role = row.role, n.graphVersion = row.graphVersion, n.idx = row.idx,
        n.type = row.type, n.label = row.label, n.source = row.source,
        n.searchText = row.searchText, n.propsJson = row.propsJson
    return count(n) as written
  `, { nodes: nodeRows })
  if (!wrote) return false

  await run(`
    unwind $edges as row
    match (a:Knowledge {key: row.fromKey})
    match (b:Knowledge {key: row.toKey})
    merge (a)-[r:REL {relation: row.relation}]->(b)
    return count(r) as written
  `, { edges: edgeRows })
  return true
}

/** Neo4j 노드를 앱이 쓰던 GraphNode 모양으로 되돌린다. */
function toGraphNode(props: any): GraphNode {
  let properties: Record<string, string | number | boolean> = {}
  try { properties = JSON.parse(props.propsJson || '{}') } catch { /* 깨졌으면 빈 값으로 둔다 */ }
  return { id: props.id, type: props.type, label: props.label, source: props.source, properties }
}

export type RetrievedGraph = {
  graphVersion: string
  role: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  sources: Array<{ id: string; label: string; type: string }>
}

/**
 * 질문에 걸리는 노드를 찾고 거기서 2홉까지 넓힌다.
 *
 * 점수 계산은 인메모리 버전과 같은 규칙을 쓴다(단어 일치 + 라벨 정확일치 + 규칙노드 가산).
 * 답이 갑자기 달라지면 안 되기 때문이다. 달라지는 것은 "얼마나 멀리까지 따라가는가" 뿐이다.
 */
export async function retrieveSubgraph(input: {
  role: string
  question: string
  terms: string[]
  asksRule: boolean
  limit?: number
  ownerId?: string
}): Promise<RetrievedGraph | undefined> {
  if (!enabled) return undefined
  const limit = input.limit ?? 6
  const normalized = input.question.toLocaleLowerCase('ko')

  const seeds = await run(`
    match (n:Knowledge) where n.role = $role
    with n, reduce(s = 0, t in $terms | s + case when n.searchText contains t then 1 else 0 end) as termScore
    with n, termScore,
         case when size(n.label) > 1 and $normalized contains toLower(n.label) then 5 else 0 end as labelScore,
         case when $asksRule and n.type = 'ServiceRule' and termScore > 0 then 3 else 0 end as ruleBoost
    with n, termScore + labelScore + ruleBoost as score
    where score > 0
    return n as node, score order by score desc, n.idx asc limit $limit
  `, {
    role: input.role,
    terms: input.terms.map((term) => term.toLocaleLowerCase('ko')),
    normalized,
    asksRule: input.asksRule,
    limit: neo4j.int(limit),
  })
  if (!seeds) return undefined
  // 아무것도 안 걸리면 인메모리 쪽 기본 동작(상위 노드 몇 개)에 맡긴다.
  if (!seeds.length) return undefined

  const seedKeys = seeds.map((record) => record.get('node').properties.key as string)

  // 2홉 확장. 방향은 따지지 않는다. "이 자료가 없어서 저 제도가 막힌다"는
  // 어느 쪽에서 걸어도 같은 사실이기 때문이다.
  const expanded = await run(`
    match (a:Knowledge) where a.key in $seedKeys
    match path = (a)-[rels:REL*1..2]-(b:Knowledge)
    where b.role = $role
    unwind rels as r
    with distinct r, startNode(r) as s, endNode(r) as e
    return s as fromNode, e as toNode, r.relation as relation
    limit 60
  `, { seedKeys, role: input.role })

  const nodesByKey = new Map<string, GraphNode>()
  for (const record of seeds) nodesByKey.set(record.get('node').properties.key, toGraphNode(record.get('node').properties))
  const edges: GraphEdge[] = []
  if (expanded) {
    for (const record of expanded) {
      const from = record.get('fromNode').properties
      const to = record.get('toNode').properties
      if (!nodesByKey.has(from.key)) nodesByKey.set(from.key, toGraphNode(from))
      if (!nodesByKey.has(to.key)) nodesByKey.set(to.key, toGraphNode(to))
      edges.push({ from: from.id, relation: record.get('relation'), to: to.id })
    }
  }

  return {
    graphVersion: `${seeds[0].get('node').properties.graphVersion}+neo4j-2hop`,
    role: input.role,
    nodes: [...nodesByKey.values()],
    edges,
    sources: seeds.slice(0, 4).map((record) => {
      const props = record.get('node').properties
      return { id: props.id, label: props.label, type: props.type }
    }),
  }
}

/**
 * 로그인한 사장님의 현재 상태를 그래프에 반영한다.
 *
 * 이게 있어야 "나 지금 뭐 받을 수 있어?"가 문자열 검색이 아니라 관계 질의가 된다.
 * 사장님 노드는 계정마다 하나이고, 상태가 바뀌면 덮어쓴다(이력은 원장이 갖는다).
 */
export async function syncOwnerSituation(input: {
  ownerId: string
  role: string
  situation: OwnerSituation
  eligibility: Array<{ programId: string; relation: 'MAY_QUALIFY_FOR' | 'BLOCKED_BY_MISSING_DATA'; reason: string }>
}) {
  if (!enabled) return false
  const { ownerId, situation } = input
  const situationKey = `owner|situation:${ownerId}`

  const ok = await run(`
    merge (o:Owner {id: $ownerId})
      set o.updatedAt = datetime()
    merge (s:Knowledge {key: $situationKey})
      set s.id = 'owner:situation', s.role = $role, s.type = 'OwnerSituation',
          s.label = $label, s.source = 'LIVE_OWNER_STATE', s.idx = -1,
          s.graphVersion = 'live-owner-state',
          s.searchText = $searchText, s.propsJson = $propsJson
    merge (o)-[:HAS_SITUATION]->(s)
    return s.key as key
  `, {
    ownerId,
    situationKey,
    role: input.role,
    label: `내 심사 현황 · ${situation.statusLabel}`,
    searchText: `${situation.statusLabel} ${situation.stageLabel} ${situation.missingRequired.join(' ')} ${situation.nextActions.join(' ')}`.toLocaleLowerCase('ko'),
    propsJson: JSON.stringify({
      stage: situation.stageLabel,
      status: situation.statusLabel,
      ...(situation.score !== null ? { score: situation.score } : {}),
      ...(situation.approvedLimit !== null ? { approvedLimit: situation.approvedLimit } : {}),
      connectedSources: situation.connectedSources.join(', ') || '없음',
      missingRequired: situation.missingRequired.join(', ') || '없음',
      mismatchCount: situation.mismatches.length,
      ...(situation.fundStatus ? { fundStatus: situation.fundStatus } : {}),
    }),
  })
  if (!ok) return false

  // 자격 관계는 매번 다시 만든다. 자료를 채우면 막혔던 제도가 풀려야 하기 때문이다.
  await run(`
    match (s:Knowledge {key: $situationKey})-[r:MAY_QUALIFY_FOR|BLOCKED_BY_MISSING_DATA]->() delete r
  `, { situationKey })

  // 관계 종류(MAY_QUALIFY_FOR / BLOCKED_BY_MISSING_DATA)는 Cypher 에서 파라미터로 못 받는다.
  // APOC 없이 Community Edition 에서도 돌아야 하므로 종류별로 나눠 만든다.
  for (const relation of ['MAY_QUALIFY_FOR', 'BLOCKED_BY_MISSING_DATA'] as const) {
    const links = input.eligibility.filter((item) => item.relation === relation)
      .map((item) => ({ programKey: `${input.role}|${item.programId}`, reason: item.reason }))
    if (!links.length) continue
    await run(`
      unwind $links as link
      match (s:Knowledge {key: $situationKey})
      match (p:Knowledge {key: link.programKey})
      merge (s)-[r:${relation}]->(p)
        set r.reason = link.reason
      return count(r) as written
    `, { situationKey, links })
  }
  return true
}

/**
 * "이 사장님이 지금 쓸 수 있는 / 막혀 있는 제도"를 그래프에서 읽는다.
 * 문자열 검색이 아니라 관계를 따라가므로, 질문에 제도 이름이 없어도 답할 수 있다.
 */
export async function ownerEligibility(ownerId: string, role: string) {
  if (!enabled) return undefined
  const records = await run(`
    match (o:Owner {id: $ownerId})-[:HAS_SITUATION]->(s:Knowledge)
    match (s)-[r:MAY_QUALIFY_FOR|BLOCKED_BY_MISSING_DATA]->(p:Knowledge)
    return type(r) as relation, r.reason as reason, p.id as programId,
           p.label as programLabel, p.propsJson as propsJson
    order by relation asc
  `, { ownerId, role })
  if (!records?.length) return undefined
  return records.map((record) => {
    let properties: Record<string, any> = {}
    try { properties = JSON.parse(record.get('propsJson') || '{}') } catch { /* 무시 */ }
    return {
      relation: record.get('relation') as string,
      reason: record.get('reason') as string,
      programId: record.get('programId') as string,
      programLabel: record.get('programLabel') as string,
      agency: properties.agency as string | undefined,
      channel: properties.channel as string | undefined,
    }
  })
}

/**
 * 사장님 상태에서 어떤 제도가 열려 있고 무엇이 막고 있는지 판정한다.
 *
 * 여기 규칙은 "안내" 기준이지 심사 기준이 아니다. 확정 조건은 각 기관 공고에 있고,
 * 그 문구는 상담 답변에 항상 함께 나간다.
 */
export function eligibilityFromSituation(situation: OwnerSituation, programs: SupportProgram[]) {
  const links: Array<{ programId: string; relation: 'MAY_QUALIFY_FOR' | 'BLOCKED_BY_MISSING_DATA'; reason: string }> = []
  const missing = situation.missingRequired
  for (const program of programs) {
    // 자금·보증은 납세·매출 자료가 없으면 신청 단계에서 막힌다.
    const needsFinancials = program.category === '정책자금' || program.category === '보증'
    if (needsFinancials && missing.length) {
      links.push({
        programId: program.id,
        relation: 'BLOCKED_BY_MISSING_DATA',
        reason: `${missing.join(', ')}이(가) 아직 없어 신청 서류를 갖추지 못했어요.`,
      })
      continue
    }
    if (needsFinancials) {
      links.push({
        programId: program.id,
        relation: 'MAY_QUALIFY_FOR',
        reason: situation.hasApplication
          ? `필수 자료가 모여 있고 심사가 ${situation.stageLabel}까지 왔어요.`
          : '필수 자료가 모여 있어 바로 상담을 시작할 수 있어요.',
      })
      continue
    }
    // 세제·공제·교육은 자료 상태와 무관하게 열려 있다.
    links.push({
      programId: program.id,
      relation: 'MAY_QUALIFY_FOR',
      reason: '제출 자료와 관계없이 사업자 상태만으로 상담할 수 있어요.',
    })
  }
  return links
}
