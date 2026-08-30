import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs.readFileSync(filePath, 'utf8').split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#') && line.includes('='))
      .map(line => {
        const index = line.indexOf('=');
        return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')];
      })
  );
}

const adminEnvPath = path.join(rootDir, '.env.admin.local');
const env = {
  ...loadEnvFile(path.join(rootDir, '.env.development.local')),
  ...loadEnvFile(path.join(rootDir, '.env.local')),
  ...loadEnvFile(adminEnvPath),
  ...process.env
};
const projectRef = env.SUPABASE_PROJECT_REF
  || String(env.VITE_SUPABASE_URL || '').replace(/^https:\/\//, '').split('.')[0];
const managementToken = env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_TOKEN;
const supabaseUrl = String(env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const adminEmail = env.MOA_ADMIN_EMAIL || 'admin@moa.local';
const generatedPassword = !env.MOA_ADMIN_PASSWORD;
const adminPassword = env.MOA_ADMIN_PASSWORD || ('Moa!' + crypto.randomBytes(12).toString('base64url'));

async function management(pathname, options = {}) {
  const response = await fetch('https://api.supabase.com/v1/' + pathname, {
    ...options,
    headers: {
      Authorization: 'Bearer ' + managementToken,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.message || data?.error || ('Supabase Management API 오류 (' + response.status + ')'));
  return data;
}

async function executeSql(sql) {
  await management('projects/' + projectRef + '/database/query', {
    method: 'POST',
    body: JSON.stringify({ query: sql })
  });
}

async function serviceRoleKey() {
  const keys = await management('projects/' + projectRef + '/api-keys');
  const key = keys.find(item => item.name === 'service_role' || item.type === 'service_role');
  if (!key?.api_key) throw new Error('Supabase service_role 키를 조회하지 못했습니다.');
  return key.api_key;
}

async function authAdmin(pathname, serviceKey, options = {}) {
  const response = await fetch(supabaseUrl + '/auth/v1/admin/' + pathname, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: 'Bearer ' + serviceKey,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.msg || data?.message || data?.error || ('Supabase Auth Admin 오류 (' + response.status + ')'));
  return data;
}

async function ensureAdminAccount() {
  const serviceKey = await serviceRoleKey();
  const listing = await authAdmin('users?page=1&per_page=1000', serviceKey);
  const users = Array.isArray(listing) ? listing : (listing?.users || []);
  const existing = users.find(user => String(user.email).toLowerCase() === adminEmail.toLowerCase());
  const payload = {
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
    user_metadata: { name: '모아 운영자', role: 'admin' }
  };
  const adminUser = existing
    ? await authAdmin('users/' + existing.id, serviceKey, { method: 'PUT', body: JSON.stringify(payload) })
    : await authAdmin('users', serviceKey, { method: 'POST', body: JSON.stringify(payload) });
  const userId = adminUser?.id || adminUser?.user?.id || existing?.id;
  if (!userId) throw new Error('운영자 계정 ID를 확인하지 못했습니다.');

  const escapedEmail = adminEmail.replaceAll("'", "''");
  await executeSql(
    'alter table public.profiles disable trigger guard_profile_role_trigger;' +
    " insert into public.profiles(id, email, display_name, role) values ('" + userId + "'::uuid, '" + escapedEmail + "', '모아 운영자', 'admin')" +
    " on conflict (id) do update set email = excluded.email, display_name = excluded.display_name, role = 'admin', updated_at = now();" +
    ' alter table public.profiles enable trigger guard_profile_role_trigger;'
  );

  if (generatedPassword) {
    fs.writeFileSync(
      adminEnvPath,
      'MOA_ADMIN_EMAIL=' + adminEmail + '\nMOA_ADMIN_PASSWORD=' + adminPassword + '\n',
      { mode: 0o600 }
    );
  }
  return { created: !existing, email: adminEmail, password: adminPassword };
}

async function main() {
  if (!managementToken || !projectRef || !supabaseUrl) {
    throw new Error('SUPABASE_ACCESS_TOKEN, Supabase 프로젝트 URL/참조값이 필요합니다.');
  }
  const schemaSql = fs.readFileSync(path.join(rootDir, 'db', 'schema.sql'), 'utf8');
  console.log('1/2 데이터베이스 스키마와 접근 정책을 적용합니다.');
  await executeSql(schemaSql);
  console.log('2/2 운영자 계정을 생성하거나 갱신합니다.');
  const admin = await ensureAdminAccount();
  console.log('완료: ' + (admin.created ? '새 운영자 계정 생성' : '운영자 계정 갱신'));
  console.log('운영자 ID: ' + admin.email);
  console.log('운영자 비밀번호: ' + admin.password);
  console.log('운영자 정보는 .env.admin.local에도 저장했습니다.');
}

main().catch(error => {
  console.error('적용 실패: ' + error.message);
  process.exit(1);
});
