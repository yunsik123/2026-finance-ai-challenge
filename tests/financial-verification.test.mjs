import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOcrBoxes, orchestrateFinancialVerification } from '../src/financial-verification.js';

test('OCR 바운딩 박스는 0~1000 범위로 제한하고 비정상 값을 제거한다', () => {
  const boxes = normalizeOcrBoxes([
    { field: 'total', label: '합계', value: '12000', bbox: [-20, 900, 1200, 200], confidence: .92 },
    { field: 'date', label: '거래일', value: '2026-08-30', bbox: [1200, 1200, 40, 40], confidence: .8 },
    { field: 'date', bbox: [1, 2, 0, 4] }
  ]);
  assert.equal(boxes.length, 2);
  assert.deepEqual(boxes[0].bbox, [0, 900, 1000, 100]);
  assert.deepEqual(boxes[1].bbox, [999, 999, 1, 1]);
});

const claims = { sales6m: [10, 11, 12, 13, 14, 15], debtTotal: 100, monthlyDebtPayment: 10, taxCompliant: true };
const documents = [
  { filename: 'pos.png', documentType: 'POS 매출내역', monthlySales: [10, 11, 12, 13, 14, 15], businessNumber: '1234567890', periodStart: '2026-01', confidence: .96, contentFingerprint: 'a' },
  { filename: 'debt.png', documentType: '부채 상환내역', debtTotal: 100, monthlyDebtPayment: 10, businessNumber: '1234567890', date: '2026-07-01', confidence: .91, contentFingerprint: 'b' },
  { filename: 'tax.png', documentType: '납세증명', taxCompliant: true, businessNumber: '1234567890', date: '2026-07-01', confidence: .94, contentFingerprint: 'c' }
];

test('필수 문서와 수치가 일치하면 운영자 검토 준비 상태가 된다', () => {
  const result = orchestrateFinancialVerification({ claims, documents, business: { number: '123-45-67890' } });
  assert.equal(result.readyForAdminReview, true);
  assert.equal(result.recommendedStatus, 'ready_for_admin');
});

test('사업자 주장과 문서 금액이 크게 다르면 공식 검증 준비가 되지 않는다', () => {
  const bad = documents.map(item => ({ ...item }));
  bad[0].monthlySales = [30, 30, 30, 30, 30, 30];
  const result = orchestrateFinancialVerification({ claims, documents: bad, business: { number: '1234567890' } });
  assert.equal(result.readyForAdminReview, false);
  assert.equal(result.recommendedStatus, 'mismatch');
  assert.match(result.mismatches.join(' '), /월평균 매출/);
});

test('필수 문서의 식별값 누락은 일부 문서가 맞아도 자동 통과하지 않는다', () => {
  const missingIdentity = documents.map(item => ({ ...item }));
  delete missingIdentity[1].businessNumber;
  const result = orchestrateFinancialVerification({ claims, documents: missingIdentity, business: { number: '1234567890' } });
  assert.equal(result.readyForAdminReview, false);
  assert.equal(result.steps.find(item => item.code === 'identity').status, 'review');
});

test('OCR 신뢰도 0~100 입력을 0~1 범위로 정규화한다', () => {
  const percentageConfidence = documents.map(item => ({ ...item, confidence: 95 }));
  const result = orchestrateFinancialVerification({ claims, documents: percentageConfidence, business: { number: '1234567890' } });
  assert.equal(result.averageConfidence, .95);
  assert.equal(result.readyForAdminReview, true);
});
