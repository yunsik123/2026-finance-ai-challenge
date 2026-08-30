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

test('스토리 생성기는 상호와 업종 기반으로 사장님 한마디, 가게 소개, 시그니처 메뉴를 생성한다', () => {
  const story = generateFallbackStoreStory({
    name: '목화 로스터리',
    category: '카페',
    address: '서울 마포구 성미산로 42'
  });

  assert.ok(story.description.includes('목화 로스터리'));
  assert.ok(story.ownerStory.length > 50);
  assert.ok(story.highlights.length >= 3);
  assert.ok(story.menuItems.length >= 3);
  assert.ok(story.menuItems.some(m => m.isSignature === true));
  assert.ok(story.menuItems.every(m => m.price > 0 && m.name));
});

test('AI 핸들러는 story-generator 모드 요청에 대해 유효한 스토리 구조를 반환한다', async () => {
  const { status, payload } = await invokeAi({
    name: '일구의 식탁',
    category: '양식',
    address: '서울 종로구 자하문로 91'
  });

  assert.equal(status, 200);
  assert.equal(payload.ok, true);
  assert.ok(payload.story.ownerStory);
  assert.ok(payload.story.menuItems.length >= 3);
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
