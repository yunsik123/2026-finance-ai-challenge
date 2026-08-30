import test from 'node:test';
import assert from 'node:assert/strict';
import aiHandler, { generateFallbackStoreStory } from '../api/ai.js';
import { DEMO_CAMPAIGNS } from '../src/demo-campaigns.js';

function invokeAi(body, mode = 'story-generator') {
  return new Promise(resolve => {
    const response = {
      statusCode: 200,
      setHeader() {},
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, payload }); }
    };
    aiHandler({ method: 'POST', query: { mode }, body, headers: {} }, response);
  });
}

test('사실 전용 문구 도우미는 입력하지 않은 사장님 스토리·메뉴·가격을 만들지 않는다', () => {
  const story = generateFallbackStoreStory({
    name: '목화 로스터리',
    category: '카페',
    address: '서울 마포구 성미산로 42'
  });

  assert.ok(story.description.includes('목화 로스터리'));
  assert.equal(story.ownerStory, '');
  assert.equal(story.menuItems.length, 0);
  assert.equal(story.requiresOwnerConfirmation, true);
});

test('story-generator 호환 경로도 확인되지 않은 사실을 채우지 않는다', async () => {
  const { status, payload } = await invokeAi({
    name: '일구의 식탁',
    category: '양식',
    address: '서울 종로구 자하문로 91'
  });

  assert.equal(status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.story.ownerStory, '');
  assert.deepEqual(payload.story.menuItems, []);
  assert.equal(payload.model, 'moa-fact-only-copy-v1');
});

test('모든 데모 캠페인은 사장님 스토리, 하이라이트 태그, 대표 메뉴판을 포함한다', () => {
  assert.ok(DEMO_CAMPAIGNS.length >= 6);
  for (const campaign of DEMO_CAMPAIGNS) {
    assert.ok(campaign.business.ownerStory, `${campaign.name} 사장님 스토리 누락`);
    assert.ok(campaign.business.highlights.length >= 3, `${campaign.name} 하이라이트 누락`);
    assert.ok(campaign.business.menuItems.length >= 3, `${campaign.name} 메뉴판 누락`);
    assert.ok(campaign.business.menuItems.some(m => m.isSignature), `${campaign.name} 시그니처 메뉴 누락`);
  }
});
