import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSubmissionStatus } from '../src/submission-status.js';
import aiHandler, {
  buildChatSystemPrompt,
  formatMissingSubmissionAnswer,
  isMissingSubmissionQuestion
} from '../api/ai.js';

function invokeAi(body) {
  return new Promise(resolve => {
    const response = {
      statusCode: 200,
      setHeader() {},
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, payload }); }
    };
    aiHandler({ method: 'POST', query: { mode: 'chat' }, body, headers: {} }, response);
  });
}

test('소상공인의 실제 저장값에서 누락 항목을 계산한다', () => {
  const status = buildSubmissionStatus({
    business: {
      name: '온기 식당', category: '한식', number: '123-45-67890', age: 3,
      address: '서울 성동구', description: '성장 계획', sales: 30000000,
      verificationStatus: 'unverified'
    },
    metrics: {
      sales_6m: [1, 2, 3, 4, 5, 6], operating_cash_flow: 1, debt_total: 0,
      monthly_debt_payment: 0, overdue_count: 0, employee_count: 0,
      tax_compliant: true, repeat_rate: 0, digital_sales_ratio: 0,
      foot_traffic_growth: 0, local_sales_growth: 0, competitor_density: 0,
      closure_rate: 0
    },
    disclosures: ['sales', 'cost', 'debt', 'plan'],
    campaign: null
  }, 'owner');

  assert.deepEqual(status.business.missing, []);
  assert.deepEqual(status.metrics.missing, []);
  assert.deepEqual(status.disclosures.missing, ['주요 위험요인', '견적·계약 증빙']);
  assert.ok(status.campaign.missing.includes('모집 제목'));
  assert.deepEqual(status.notCollectedAsRequiredUploads, ['재무제표', '최근 3개월 은행 거래 내역', '세금 신고서']);
});

test('빠진 자료 질문은 구조화된 현황으로 답하고 일반 금융서류를 요구하지 않는다', () => {
  assert.equal(isMissingSubmissionQuestion('제출 자료에서 빠진 항목은?'), true);
  const status = buildSubmissionStatus({ disclosures: ['sales'] }, 'owner');
  const answer = formatMissingSubmissionAnswer(status);

  assert.match(answer, /투자자 공개 항목: 비용 구조/);
  assert.match(answer, /재무제표.*필수 제출 항목이 아닙니다/);
  assert.doesNotMatch(answer, /재무제표를 제출/);
});

test('상담 API의 빠진 자료 질문은 OpenAI 호출 없이 규칙 기반 응답을 반환한다', async () => {
  const submissionStatus = buildSubmissionStatus({ disclosures: ['sales'] }, 'owner');
  const { status, payload } = await invokeAi({
    messages: [{ role: 'user', content: '제출 자료에서 빠진 항목은?' }],
    context: '테스트 컨텍스트',
    submissionStatus
  });

  assert.equal(status, 200);
  assert.equal(payload.model, 'moa-submission-rules-v1');
  assert.match(payload.message, /투자자 공개 항목: 비용 구조/);
});

test('소상공인 본인 현황이 없으면 확인 불가 이유와 구현 범위를 설명한다', () => {
  const answer = formatMissingSubmissionAnswer(buildSubmissionStatus({}, 'investor'));
  assert.match(answer, /소상공인 본인의 저장 현황/);
  assert.match(answer, /재무제표.*필수 제출받지 않습니다/);
});

test('일반 상담 프롬프트도 구현되지 않은 서류의 임의 요구를 금지한다', () => {
  const prompt = buildChatSystemPrompt('모아 제출 현황: 테스트');
  assert.match(prompt, /누락 여부는 컨텍스트의 “모아 제출 현황”만 근거/);
  assert.match(prompt, /일반 금융기관 서류를 모아의 필수 자료처럼 나열하지 마세요/);
  assert.match(prompt, /세금 정상 납부 여부는 예\/아니오 입력값/);
});
