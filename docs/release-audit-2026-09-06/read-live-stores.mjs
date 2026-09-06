import { loadEnvFile } from 'node:process'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'
import neo4j from 'neo4j-driver'
loadEnvFile(path.resolve(import.meta.dirname,'../../.env'))
const result={at:new Date().toISOString(), mode:'READ ONLY; aggregate counts and schema checks only'}
const url=new URL(process.env.DATABASE_URL)
if(process.env.AUDIT_TUNNELS==='1') {url.hostname='127.0.0.1';url.port='15432';url.searchParams.set('sslmode','disable')}
const ssl=url.searchParams.get('sslmode')==='disable'?undefined:{rejectUnauthorized:false}
url.searchParams.delete('sslmode')
const client=new pg.Client({connectionString:url.toString(),ssl,connectionTimeoutMillis:15000,statement_timeout:20000})
try{
  await client.connect()
  await client.query('BEGIN READ ONLY')
  const {rows:tables}=await client.query("select table_name from information_schema.tables where table_schema='meoktu' order by table_name")
  const {rows:ledger}=await client.query('select meoktu.read_ledger() as ledger')
  const data=ledger[0].ledger.data
  const counts=Object.fromEntries(Object.entries(data).filter(([k,v])=>Array.isArray(v)).map(([k,v])=>[k,v.length]))
  const {rows:functions}=await client.query("select p.proname,pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='meoktu' and p.proname in ('read_ledger','save_ledger','import_ledger')")
  result.postgres={connected:true,version:ledger[0].ledger.version,tables:tables.map(x=>x.table_name),counts,
    documentsKeyPresent:Object.hasOwn(data,'documents'),legalConsentsKeyPresent:Object.hasOwn(data,'legalConsents'),
    functions:functions.map(x=>({name:x.proname,handlesDocuments:/owner_documents|payload\s*->\s*'documents'|'documents'\s*,/.test(x.definition)})),
    applicationsWithBusinessNumber:(data.applications||[]).filter(a=>a.data?.businessNumber).length,
    applicationsWithOcrLinks:(data.applications||[]).filter(a=>a.data?.ocrAnalysisIds?.length).length,
    applicationsWithSixSteps:(data.applications||[]).filter(a=>a.data?.financialVerification?.steps?.length===6).length}
  await client.query('ROLLBACK')
}catch(e){result.postgres={connected:false,error:e.code||e.name,message:String(e.message).replace(/postgres(?:ql)?:\/\/\S+/g,'[redacted]')}}
finally{await client.end().catch(()=>{})}
const driver=neo4j.driver(process.env.AUDIT_TUNNELS==='1'?'bolt://127.0.0.1:17687':process.env.NEO4J_URI,neo4j.auth.basic(process.env.NEO4J_USER||'neo4j',process.env.NEO4J_PASSWORD),{connectionAcquisitionTimeout:15000})
try{
  const session=driver.session({database:process.env.NEO4J_DATABASE||'neo4j',defaultAccessMode:neo4j.session.READ})
  const report=await session.executeRead(async tx=>{
    const counts=await tx.run('MATCH (n) RETURN labels(n) AS labels,count(n) AS count')
    const owner=await tx.run("MATCH (n:Knowledge) WHERE n.role='owner' AND n.type='OwnerSituation' RETURN count(n) AS count")
    const shared=await tx.run("MATCH (n:Knowledge) WHERE n.role='owner' AND (n.searchText CONTAINS '자료' OR n.searchText CONTAINS '심사') RETURN count(n) AS allMatches,count(CASE WHEN n.type='OwnerSituation' THEN 1 END) AS privateSituationMatches")
    const edges=await tx.run('MATCH ()-[r]->() RETURN type(r) AS type,count(r) AS count')
    return {connected:true,nodes:counts.records.map(r=>({labels:r.get('labels'),count:r.get('count').toNumber()})),
      ownerSituations:owner.records[0].get('count').toNumber(),
      roleOnlySearchPrivateCandidates:shared.records[0].get('privateSituationMatches').toNumber(),
      edges:edges.records.map(r=>({type:r.get('type'),count:r.get('count').toNumber()}))}
  })
  result.neo4j=report
  await session.close()
}catch(e){result.neo4j={connected:false,error:e.code||e.name,message:String(e.message).replace(/(?:bolt|neo4j):\/\/[^\s]+/g,'[redacted]')}}
finally{await driver.close()}
await writeFile(path.join(import.meta.dirname,'live-store-results.json'),JSON.stringify(result,null,2))
console.log(JSON.stringify(result,null,2))
process.exit(0)
