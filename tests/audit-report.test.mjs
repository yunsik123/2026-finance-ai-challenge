import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAuditReport, renderAuditReportHtml } from '../src/audit-report.js';

test('심사 보고서는 저장된 모집·평가·증빙만 구조화한다', () => {
  const report = buildAuditReport({
    campaign: { id: 'c1', name: '주방 교체', target: 10_000_000, plan: '인덕션 구매', risk: '공사 지연', status: 'submitted', business: { name: '온기', number: '123', representativeName: '홍길동' }, milestones: [] },
    verification: { status: 'approved', orchestration: { documentCount: 3, averageConfidence: .9 } },
    evidence: [{ id: 'e1', campaignId: 'other', filename: '다른모집.png' }, { id: 'e2', campaignId: 'c1', filename: '견적서.png', claimedAmount: 1000 }]
  });
  assert.equal(report.evidence.length, 1);
  assert.equal(report.evidence[0].filename, '견적서.png');
  const html = renderAuditReportHtml(report, { standalone: true });
  assert.match(html, /종합 심사·감사 보고서/);
  assert.match(html, /인덕션 구매/);
  assert.doesNotMatch(html, /다른모집/);
});
