import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { normalizeQuickAccountName, quickAccountEmail } from '../src/supabase-cloud.js';

test('간편 로그인 이름은 공백·호환문자·대소문자를 일관되게 정규화한다', () => {
  assert.equal(normalizeQuickAccountName('  ＭＯＡ   사용자  '), 'moa 사용자');
});

test('같은 역할과 로그인 이름은 같은 비공개 Auth 식별자를 만든다', async () => {
  const first = await quickAccountEmail('홍길동', 'investor');
  const second = await quickAccountEmail('  홍길동 ', 'investor');
  assert.equal(first, second);
  assert.match(first, /^q-investor-[a-f0-9]{40}@accounts\.moa\.local$/);
  assert.doesNotMatch(first, /홍길동/);
});

test('역할이 다르면 같은 로그인 이름도 별도 계정이 된다', async () => {
  assert.notEqual(
    await quickAccountEmail('온기식당', 'investor'),
    await quickAccountEmail('온기식당', 'owner')
  );
  await assert.rejects(() => quickAccountEmail('운영자', 'admin'), /간편 계정을 만들 수 없는 역할/);
});

test('간편 인증은 역할별 공용 계정이나 화면 전용 이름 덮어쓰기를 사용하지 않는다', () => {
  const source = fs.readFileSync(new URL('../src/supabase-cloud.js', import.meta.url), 'utf8');
  const quickBranch = source.slice(source.indexOf('if (values.quick)'), source.indexOf("if (values.action === 'signup')", source.indexOf('if (values.quick)') + 1));
  assert.doesNotMatch(quickBranch, /investor@moa\.local|owner@moa\.local|custom_name|profiles\?id=eq/);
});
