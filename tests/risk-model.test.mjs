import test from 'node:test';
import assert from 'node:assert/strict';
import { ASSESSMENT_BASELINE, assessMetrics, scoreContributions } from '../src/risk-model.js';

const claims = {
  sales6m: [20_000_000, 21_000_000, 22_000_000, 23_000_000, 24_000_000, 25_000_000],
  operatingCashFlow: 5_000_000,
  monthlyDebtPayment: 1_000_000,
  debtTotal: 50_000_000,
  overdueCount: 0,
  employeeCount: 3,
  taxCompliant: true,
  footTrafficGrowth: 4,
  localSalesGrowth: 3,
  closureRate: 8,
  competitorDensity: .72,
  administrativeActionCount: 0,
  representativeChangeCount: 0
};

test('예비평가는 기준점과 요인별 기여도로 최종점수를 정확히 재구성한다', () => {
  const assessment = assessMetrics(claims, { sales: 22_000_000, age: 5, number: '123-45-67890' });
  const reconstructed = ASSESSMENT_BASELINE + assessment.contributions.reduce((sum, item) => sum + item.contribution, 0);
  assert.equal(assessment.score, Number(reconstructed.toFixed(1)));
  assert.equal(assessment.methodology.calibratedProbability, false);
  assert.equal(assessment.contributions.length, 5);
});

test('매출 변동성이 큰 업체는 같은 시작·종료 매출이어도 지속성 점수가 낮다', () => {
  const stable = assessMetrics(claims, { sales: 22_000_000, age: 5, number: '1' });
  const volatile = assessMetrics({ ...claims, sales6m: [20_000_000, 35_000_000, 8_000_000, 34_000_000, 9_000_000, 25_000_000] }, { sales: 22_000_000, age: 5, number: '1' });
  assert.ok(stable.components['매출 지속성'] > volatile.components['매출 지속성']);
});

test('저장된 구성점수도 동일한 기여도로 분해할 수 있다', () => {
  const values = { '매출 지속성': 80, '현금흐름 여력': 70, '부채 부담': 50, '사업 운영 안정성': 60, '상권 회복력': 40 };
  const contributions = scoreContributions(values);
  assert.equal(contributions.find(item => item.label === '매출 지속성').contribution, 5);
  assert.equal(contributions.find(item => item.label === '상권 회복력').contribution, -3);
});
