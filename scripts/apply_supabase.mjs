import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf-8');
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
  }
  return env;
}

const envLocal = loadEnvFile(path.join(rootDir, '.env.local'));
const envDev = loadEnvFile(path.join(rootDir, '.env.development.local'));
const envDefault = loadEnvFile(path.join(rootDir, '.env'));

const env = { ...envDefault, ...envDev, ...envLocal, ...process.env };

const SUPABASE_PROJECT_REF = env.SUPABASE_PROJECT_REF || (env.VITE_SUPABASE_URL ? env.VITE_SUPABASE_URL.replace(/https:\/\//, '').split('.')[0] : 'udrbqexmxjyiruebooxx');
const SUPABASE_ACCESS_TOKEN = env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_TOKEN || process.env.SUPABASE_ACCESS_TOKEN;

async function executeSqlViaManagementApi(token, projectRef, sql, stepName) {
  console.log(`🚀 [${stepName}] Supabase에 SQL을 전송하여 실행 중... (프로젝트: ${projectRef})`);
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: sql })
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`[${stepName}] SQL 실행 실패 (${res.status}): ${errorText}`);
  }

  const result = await res.json().catch(() => null);
  console.log(`✅ [${stepName}] 실행 완료!`);
  return result;
}

async function main() {
  console.log('========================================================');
  console.log('  MOA Supabase 자동 DB 마이그레이션 & 시드 적용기');
  console.log('========================================================\n');

  if (!SUPABASE_ACCESS_TOKEN) {
    console.error('❌ SUPABASE_ACCESS_TOKEN 이 설정되지 않았습니다.\n');
    console.log('👉 [해결 방법 - 딱 1번만 설정하면 영구 자동화]');
    console.log('1. 브라우저에서 https://supabase.com/dashboard/account/tokens 접속');
    console.log('2. "Generate New Token" 클릭 후 발급된 토큰 복사');
    console.log('3. .env.local 파일에 아래 한 줄 추가:');
    console.log('   SUPABASE_ACCESS_TOKEN=sbp_여기에토큰붙여넣기\n');
    console.log('4. 다시 npm run db:apply 실행하면 웹 복붙 없이 100% 자동 적용됩니다!\n');
    process.exit(1);
  }

  const schemaPath = path.join(rootDir, 'db', 'schema.sql');
  const seedPath = path.join(rootDir, 'db', 'seed.sql');

  if (!fs.existsSync(schemaPath)) {
    console.error(`❌ 파일이 없습니다: ${schemaPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(seedPath)) {
    console.error(`❌ 파일이 없습니다: ${seedPath}`);
    process.exit(1);
  }

  const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
  const seedSql = fs.readFileSync(seedPath, 'utf-8');

  try {
    console.log('1단계: schema.sql (테이블 및 RLS 보안 정책 생성)');
    await executeSqlViaManagementApi(SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF, schemaSql, 'Schema');

    console.log('\n2단계: seed.sql (소상공인 3명 및 샘플 데이터 입력)');
    await executeSqlViaManagementApi(SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF, seedSql, 'Seed');

    console.log('\n🎉 축하합니다! 모든 DB 테이블과 시드 데이터가 Supabase에 성공적으로 적용되었습니다.');
  } catch (err) {
    console.error(`\n❌ 오류 발생: ${err.message}`);
    process.exit(1);
  }
}

main();
