const number = value => Number.isFinite(Number(value)) ? Number(value) : null;
const series = value => Array.isArray(value) ? value.map(number).filter(item => item !== null) : [];
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

export function normalizeOcrBoxes(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 24).flatMap(item => {
    const box = Array.isArray(item?.bbox) ? item.bbox.map(Number) : [];
    if (box.length !== 4 || box.some(number => !Number.isFinite(number))) return [];
    const [x, y, width, height] = box;
    if (width <= 0 || height <= 0) return [];
    return [{
      field: String(item.field || 'unknown').slice(0, 80),
      label: String(item.label || item.field || '필드').slice(0, 120),
      value: String(item.value ?? '').slice(0, 300),
      bbox: [
        Math.max(0, Math.min(1000, x)), Math.max(0, Math.min(1000, y)),
        Math.max(1, Math.min(1000 - Math.max(0, x), width)),
        Math.max(1, Math.min(1000 - Math.max(0, y), height))
      ],
      confidence: Math.max(0, Math.min(1, Number(item.confidence || 0)))
    }];
  });
}

function difference(claimed, observed) {
  if (claimed === null || observed === null) return null;
  return Math.abs(claimed - observed) / Math.max(Math.abs(observed), 1);
}

function compare(label, claimed, observed, source, tolerance = .05) {
  const delta = difference(claimed, observed);
  if (delta === null) return { label, status: 'not_compared', claimed, observed, source };
  return {
    label, claimed, observed, source, differenceRate: Number((delta * 100).toFixed(1)),
    status: delta <= tolerance ? 'matched' : delta <= .15 ? 'review' : 'mismatch'
  };
}

function category(document) {
  const type = String(document.documentType || '').toLowerCase();
  if (/pos|카드|매출|sales/.test(type)) return 'sales';
  if (/부채|대출|상환|debt|loan/.test(type)) return 'debt';
  if (/납세|세금|tax/.test(type)) return 'tax';
  if (/은행|통장|bank/.test(type)) return 'bank';
  return 'other';
}

export function orchestrateFinancialVerification({ claims = {}, documents = [], business = {} } = {}) {
  const safeDocuments = documents.map((item, index) => {
    const rawConfidence = Number(item.confidence || 0);
    const confidence = Math.max(0, Math.min(1, rawConfidence > 1 ? rawConfidence / 100 : rawConfidence));
    return { ...item, index, category: category(item), confidence, boundingBoxes: normalizeOcrBoxes(item.boundingBoxes) };
  });
  const categories = new Set(safeDocuments.map(item => item.category));
  const missingDocuments = [
    !categories.has('sales') && 'POS·카드매출 내역',
    !categories.has('debt') && '부채·월 상환 내역',
    !categories.has('tax') && '납세 확인 자료'
  ].filter(Boolean);
  const steps = [
    { code: 'identity', label: '사업자 식별값 대조', status: 'pending' },
    { code: 'period', label: '문서 기준기간 확인', status: 'pending' },
    { code: 'sales', label: '6개월 매출 교차검증', status: 'pending' },
    { code: 'debt', label: '부채·상환액 교차검증', status: 'pending' },
    { code: 'tax', label: '납세 상태 교차검증', status: 'pending' },
    { code: 'consistency', label: '문서 간 모순·중복 검사', status: 'pending' }
  ];
  const expectedNumber = String(business.number || '').replace(/\D/g, '');
  const observedNumbers = safeDocuments.map(item => String(item.businessNumber || '').replace(/\D/g, '')).filter(Boolean);
  const identityMismatch = expectedNumber && observedNumbers.length && observedNumbers.some(value => value !== expectedNumber);
  const requiredDocuments = safeDocuments.filter(item => ['sales', 'debt', 'tax'].includes(item.category));
  const missingIdentity = requiredDocuments.some(item => !String(item.businessNumber || '').replace(/\D/g, ''));
  steps[0].status = identityMismatch ? 'failed' : (!observedNumbers.length || missingIdentity) ? 'review' : 'passed';

  const dated = safeDocuments.filter(item => item.periodStart || item.periodEnd || item.date);
  steps[1].status = dated.length === safeDocuments.length ? 'passed' : dated.length ? 'review' : 'failed';

  const comparisons = [];
  const salesDocument = safeDocuments.find(item => item.category === 'sales' && series(item.monthlySales).length);
  const claimedSales = series(claims.sales6m);
  if (salesDocument) {
    const observed = series(salesDocument.monthlySales);
    comparisons.push(compare('월평균 매출', mean(claimedSales), mean(observed), salesDocument.filename));
  }
  steps[2].status = !salesDocument ? 'failed' : comparisons.at(-1).status === 'mismatch' ? 'failed' : comparisons.at(-1).status;

  const debtDocument = safeDocuments.find(item => item.category === 'debt');
  if (debtDocument) {
    comparisons.push(compare('총 부채', number(claims.debtTotal), number(debtDocument.debtTotal), debtDocument.filename));
    comparisons.push(compare('월 상환액', number(claims.monthlyDebtPayment), number(debtDocument.monthlyDebtPayment), debtDocument.filename));
  }
  const debtComparisons = comparisons.filter(item => ['총 부채', '월 상환액'].includes(item.label));
  steps[3].status = !debtDocument ? 'failed' : debtComparisons.some(item => item.status === 'mismatch') ? 'failed'
    : debtComparisons.some(item => item.status === 'review' || item.status === 'not_compared') ? 'review' : 'passed';

  const taxDocument = safeDocuments.find(item => item.category === 'tax');
  if (taxDocument && typeof taxDocument.taxCompliant === 'boolean') {
    comparisons.push({ label: '세금 정상 납부', claimed: Boolean(claims.taxCompliant), observed: taxDocument.taxCompliant,
      source: taxDocument.filename, status: Boolean(claims.taxCompliant) === taxDocument.taxCompliant ? 'matched' : 'mismatch' });
  }
  const taxComparison = comparisons.find(item => item.label === '세금 정상 납부');
  steps[4].status = !taxComparison ? 'failed' : taxComparison.status === 'matched' ? 'passed' : 'failed';

  const hashes = safeDocuments.map(item => item.contentFingerprint).filter(Boolean);
  const hasDuplicate = new Set(hashes).size !== hashes.length;
  steps[5].status = hasDuplicate ? 'failed' : 'passed';
  const mismatches = [
    ...(identityMismatch ? ['문서의 사업자등록번호가 등록 사업체와 다릅니다.'] : []),
    ...(hasDuplicate ? ['동일한 문서 내용이 중복 제출됐습니다.'] : []),
    ...comparisons.filter(item => item.status === 'mismatch').map(item => `${item.label} 입력값과 문서값이 일치하지 않습니다.`)
  ];
  const warnings = [
    ...(missingIdentity ? ['필수 문서 일부에서 사업자등록번호를 확인하지 못했습니다.'] : []),
    ...comparisons.filter(item => item.status === 'review').map(item => `${item.label} 차이가 5%를 넘어 운영자 확인이 필요합니다.`),
    ...safeDocuments.filter(item => Number(item.confidence || 0) < .75).map(item => `${item.filename || '문서'} OCR 신뢰도가 낮습니다.`)
  ];
  const averageConfidence = safeDocuments.length
    ? safeDocuments.reduce((sum, item) => sum + Number(item.confidence || 0), 0) / safeDocuments.length : 0;
  const readyForAdminReview = missingDocuments.length === 0 && mismatches.length === 0
    && steps.every(item => ['passed', 'matched'].includes(item.status)) && averageConfidence >= .75;
  return {
    version: 'moa-financial-orchestrator-v1', steps, comparisons, missingDocuments, mismatches, warnings,
    documentCount: safeDocuments.length, averageConfidence: Number(averageConfidence.toFixed(2)),
    readyForAdminReview,
    recommendedStatus: readyForAdminReview ? 'ready_for_admin' : mismatches.length ? 'mismatch' : 'needs_documents'
  };
}
