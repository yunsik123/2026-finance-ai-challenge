const escape = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[character]));

const won = value => Number(value || 0).toLocaleString('ko-KR') + '원';
const date = value => value ? new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
}).format(new Date(value)) : '-';

export function buildAuditReport({ campaign = {}, verification = null, evidence = [], audit = [] } = {}) {
  const business = campaign.business || verification?.business || {};
  const assessment = campaign.assessment || null;
  const relatedEvidence = evidence.filter(item => !campaign.id || item.campaignId === campaign.id);
  const relatedAudit = audit.filter(item => {
    const entityId = item.entityId || item.entity_id;
    return !campaign.id || entityId === campaign.id || relatedEvidence.some(evidenceItem => evidenceItem.id === entityId);
  });
  return {
    reportVersion: 'moa-audit-report-v1',
    generatedAt: new Date().toISOString(),
    campaign: {
      id: campaign.id || '', name: campaign.name || '', status: campaign.status || '',
      target: Number(campaign.target || 0), plan: campaign.plan || '', risk: campaign.risk || ''
    },
    business: {
      name: business.name || '', number: business.number || '', representativeName: business.representativeName || '',
      address: business.address || '', verificationStatus: business.verificationStatus || ''
    },
    assessment: assessment ? {
      score: Number(assessment.score || 0), grade: assessment.grade || '', riskLevel: assessment.riskLevel || '',
      fundingLimit: Number(assessment.fundingLimit || 0), isOfficial: Boolean(assessment.isOfficial),
      modelVersion: assessment.modelVersion || '', components: assessment.components || {},
      contributions: assessment.contributions || []
    } : null,
    financialVerification: verification ? {
      id: verification.id || '', status: verification.status || '', reviewedAt: verification.reviewedAt || null,
      reviewNote: verification.reviewNote || '', orchestration: verification.orchestration || {}
    } : null,
    milestones: (campaign.milestones || []).map(item => ({
      sequence: item.sequence, title: item.title, condition: item.condition, percent: Number(item.percent || 0), status: item.status
    })),
    evidence: relatedEvidence.map(item => ({
      id: item.id, filename: item.filename, claimedAmount: Number(item.claimedAmount || 0),
      status: item.status, planMatch: item.planMatch, reviewedAt: item.reviewedAt || null, reviewNote: item.reviewNote || ''
    })),
    audit: relatedAudit.map(item => ({ action: item.action, entityType: item.entityType || item.entity_type, at: item.createdAt || item.created_at }))
  };
}

function tableRows(items, emptyText, render) {
  return items.length ? items.map(render).join('') : `<tr><td colspan="4">${escape(emptyText)}</td></tr>`;
}

export function renderAuditReportHtml(report, { standalone = false } = {}) {
  const verification = report.financialVerification;
  const flow = verification?.orchestration || {};
  const assessment = report.assessment;
  const body = `<article class="audit-report">
    <header><div><p>MOA ALTERNATIVE ASSESSMENT</p><h1>종합 심사·감사 보고서</h1></div><dl><dt>보고서 버전</dt><dd>${escape(report.reportVersion)}</dd><dt>생성 시각</dt><dd>${escape(date(report.generatedAt))}</dd></dl></header>
    <section><h2>1. 사업·모집 식별</h2><div class="report-grid"><dl><dt>상호</dt><dd>${escape(report.business.name || '-')}</dd><dt>사업자번호</dt><dd>${escape(report.business.number || '-')}</dd><dt>대표자</dt><dd>${escape(report.business.representativeName || '-')}</dd></dl><dl><dt>모집안</dt><dd>${escape(report.campaign.name || '-')}</dd><dt>목표금액</dt><dd>${escape(won(report.campaign.target))}</dd><dt>현재 상태</dt><dd>${escape(report.campaign.status || '-')}</dd></dl></div></section>
    <section><h2>2. 재무 교차검증·평가</h2>${assessment ? `<div class="score-strip"><strong>${escape(assessment.grade || '-')} · ${escape(assessment.score)}점</strong><span>최대 모집 한도 ${escape(won(assessment.fundingLimit))}</span><b>${assessment.isOfficial ? '운영자 승인 공식평가' : '미검증 예비평가'}</b></div><table><thead><tr><th>요인</th><th>점수</th><th>기여도</th><th>반영</th></tr></thead><tbody>${Object.entries(assessment.components).map(([label, value]) => { const contribution = assessment.contributions.find(item => item.label === label)?.contribution; return `<tr><td>${escape(label)}</td><td>${escape(value)}</td><td>${contribution == null ? '-' : escape((contribution >= 0 ? '+' : '') + contribution)}</td><td>${escape(assessment.modelVersion || '-')}</td></tr>`; }).join('')}</tbody></table>` : '<p>저장된 평가가 없습니다.</p>'}
      <div class="report-grid"><dl><dt>재무검증 상태</dt><dd>${escape(verification?.status || '미제출')}</dd><dt>문서 수</dt><dd>${escape(flow.documentCount || 0)}</dd><dt>OCR 평균 신뢰도</dt><dd>${escape(Math.round(Number(flow.averageConfidence || 0) * 100))}%</dd></dl><dl><dt>불일치</dt><dd>${escape((flow.mismatches || []).join(' ') || '없음')}</dd><dt>누락</dt><dd>${escape((flow.missingDocuments || []).join(', ') || '없음')}</dd><dt>운영자 기록</dt><dd>${escape(verification?.reviewNote || '-')}</dd></dl></div></section>
    <section><h2>3. 자금 사용·위험</h2><h3>사용계획</h3><p>${escape(report.campaign.plan || '-')}</p><h3>공개 위험과 대응</h3><p>${escape(report.campaign.risk || '-')}</p></section>
    <section><h2>4. 마일스톤·증빙</h2><table><thead><tr><th>순서</th><th>지급 조건</th><th>비율</th><th>상태</th></tr></thead><tbody>${tableRows(report.milestones, '등록된 마일스톤이 없습니다.', item => `<tr><td>${escape(item.sequence)}</td><td><b>${escape(item.title)}</b><br>${escape(item.condition)}</td><td>${escape(item.percent)}%</td><td>${escape(item.status)}</td></tr>`)}</tbody></table>
      <table><thead><tr><th>증빙</th><th>신청액</th><th>계획 일치</th><th>심사</th></tr></thead><tbody>${tableRows(report.evidence, '제출된 증빙이 없습니다.', item => `<tr><td>${escape(item.filename || '-')}</td><td>${escape(won(item.claimedAmount))}</td><td>${escape(item.planMatch || '-')}</td><td>${escape(item.status || '-')}</td></tr>`)}</tbody></table></section>
    <footer><b>유의사항</b><p>이 보고서는 MOA에 저장된 정보와 심사 이력의 스냅샷입니다. OCR과 정량점수는 검토 보조수단이며, 신용보증·투자권유·지급 승인을 자동 확정하지 않습니다.</p></footer>
  </article>`;
  if (!standalone) return body;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escape(report.business.name || 'MOA')} 심사보고서</title><style>body{font:14px/1.6 Arial,sans-serif;color:#173d34;margin:0;background:#eee}.audit-report{max-width:900px;margin:24px auto;padding:42px;background:#fff}.audit-report header{display:flex;justify-content:space-between;border-bottom:3px solid #173d34}.audit-report h1{margin-top:4px}.audit-report h2{margin-top:30px;border-bottom:1px solid #ccc}.audit-report dl{display:grid;grid-template-columns:120px 1fr;gap:6px}.audit-report dt{color:#6c7a74}.audit-report dd{margin:0;font-weight:700}.report-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}.score-strip{display:flex;gap:18px;align-items:center;padding:16px;background:#eaf3ef}.score-strip strong{font-size:24px}table{width:100%;border-collapse:collapse;margin:12px 0}th,td{padding:9px;border:1px solid #ddd;text-align:left;vertical-align:top}footer{margin-top:32px;padding:16px;background:#fff0ea}@media print{body{background:#fff}.audit-report{margin:0;max-width:none;padding:18mm;box-shadow:none}}@media(max-width:650px){.report-grid{grid-template-columns:1fr}.audit-report{margin:0;padding:20px}}</style></head><body>${body}</body></html>`;
}
