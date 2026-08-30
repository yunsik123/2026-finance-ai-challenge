export const DISCLOSURE_ITEMS = [
  { code: 'sales', label: '최근 12개월 매출' },
  { code: 'cost', label: '비용 구조' },
  { code: 'debt', label: '부채와 상환 부담' },
  { code: 'plan', label: '자금 사용계획' },
  { code: 'risk', label: '주요 위험요인' },
  { code: 'evidence', label: '견적·계약 증빙' }
];

const BUSINESS_FIELDS = [
  ['name', '상호명'],
  ['category', '업종'],
  ['number', '사업자등록번호'],
  ['age', '업력'],
  ['address', '사업장 주소'],
  ['description', '가게와 성장 계획 소개'],
  ['sales', '최근 월평균 매출']
];

const METRIC_FIELDS = [
  ['sales_6m', '최근 6개월 월별 매출'],
  ['operating_cash_flow', '월 영업현금흐름'],
  ['debt_total', '총 부채'],
  ['monthly_debt_payment', '월 부채 상환액'],
  ['overdue_count', '최근 1년 연체 횟수'],
  ['employee_count', '상시 근로자 수'],
  ['tax_compliant', '세금 정상 납부 여부'],
  ['repeat_rate', '재방문율'],
  ['digital_sales_ratio', '온라인 매출 비중'],
  ['foot_traffic_growth', '상권 유동인구 증감률'],
  ['local_sales_growth', '상권 매출 증감률'],
  ['competitor_density', '경쟁 밀도'],
  ['closure_rate', '주변 폐업률']
];

const CAMPAIGN_FIELDS = [
  ['name', '모집 제목'],
  ['target', '목표 금액'],
  ['duration', '모집 기간'],
  ['plan', '상세 자금 사용계획'],
  ['risk', '주요 위험과 대응계획']
];

function isPresent(value) {
  return value !== null && value !== undefined && (typeof value !== 'string' || value.trim() !== '');
}

function missingObjectFields(object, fields) {
  if (!object) return fields.map(([, label]) => label);
  return fields.filter(([key]) => !isPresent(object[key])).map(([, label]) => label);
}

export function buildSubmissionStatus(owner = {}, viewerRole = '') {
  const business = owner.business || null;
  const metrics = owner.metrics || null;
  const campaign = owner.campaign || null;
  const selectedDisclosures = Array.isArray(owner.disclosures) ? owner.disclosures : [];
  const businessMissing = missingObjectFields(business, BUSINESS_FIELDS);
  const metricsMissing = missingObjectFields(metrics, METRIC_FIELDS);

  if (metrics && (!Array.isArray(metrics.sales_6m) || metrics.sales_6m.length !== 6)) {
    if (!metricsMissing.includes('최근 6개월 월별 매출')) metricsMissing.unshift('최근 6개월 월별 매출');
  }

  const disclosureMissing = DISCLOSURE_ITEMS
    .filter(item => !selectedDisclosures.includes(item.code))
    .map(item => item.label);
  const campaignMissing = missingObjectFields(campaign, CAMPAIGN_FIELDS);
  const milestones = Array.isArray(campaign?.milestones) ? campaign.milestones : [];
  if (campaign && milestones.length < 2) campaignMissing.push('지급 단계 2개 이상');
  if (campaign && milestones.reduce((sum, item) => sum + Number(item.percent || 0), 0) !== 100) {
    campaignMissing.push('지급 비율 합계 100%');
  }
  if (campaign && milestones.some(item => !item.title || !item.condition || Number(item.percent) <= 0)) {
    campaignMissing.push('각 지급 단계의 이름·조건·지급 비율');
  }

  const executionRequired = campaign?.status === 'published';
  const currentMilestone = executionRequired
    ? milestones.find((item, index) => ['planned', 'rejected'].includes(item.status)
      && milestones.slice(0, index).every(previous => previous.status === 'released')) || null
    : null;

  return {
    schemaVersion: 1,
    viewerRole,
    canDetermineOwnerMissingItems: viewerRole === 'owner',
    business: {
      saved: Boolean(business),
      missing: businessMissing,
      verificationStatus: business?.verificationStatus || 'unverified'
    },
    metrics: { saved: Boolean(metrics), missing: metricsMissing },
    disclosures: {
      selected: DISCLOSURE_ITEMS.filter(item => selectedDisclosures.includes(item.code)).map(item => item.label),
      missing: disclosureMissing
    },
    campaign: {
      saved: Boolean(campaign),
      status: campaign?.status || 'not_created',
      missing: campaignMissing
    },
    execution: {
      requiredNow: executionRequired,
      currentMilestone: currentMilestone
        ? { title: currentMilestone.title, condition: currentMilestone.condition, status: currentMilestone.status }
        : null,
      acceptedImageEvidence: ['세금계산서', '영수증', '매출전표', '계약서', '견적서', '설치 완료 사진']
    },
    notCollectedAsRequiredUploads: ['재무제표', '최근 3개월 은행 거래 내역', '세금 신고서'],
    notes: [
      '사업자등록번호와 확인 상태를 저장하지만 현재 사업자등록증 파일 업로드 기능은 없다.',
      '세금 정상 납부 여부는 예/아니오 입력값이며 세금 신고서 파일이 아니다.',
      '증빙 이미지는 모집 공개 후 현재 열린 지급 단계의 조건에 맞춰 제출한다.'
    ]
  };
}
