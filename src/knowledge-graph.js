const node = (id, type, label, properties = {}, source = 'MOA_SERVICE_POLICY') => ({
  id, type, label, properties, source
});

const edge = (from, relation, to) => ({ from, relation, to });

const INVESTOR_PROCESS = [
  node('investor:start', 'GuideStep', '투자 시작', { order: 1, instruction: '투자자 계정으로 로그인하고 관심 지역·업종의 공개 모집을 탐색합니다.' }),
  node('investor:learn', 'GuideStep', '상품 구조 이해', { order: 2, instruction: '모아의 현재 상품은 현금 이자·지분이 아니라 투자 유지기간에 따라 가게 쿠폰이 쌓이는 소비 쿠폰형 참여입니다.' }),
  node('investor:review', 'GuideStep', '사업과 위험 검토', { order: 3, instruction: '사업자 확인, 공식 검증된 재무점검, 상권, 자금 사용계획, 위험요인과 단계별 지급조건을 확인합니다.' }),
  node('investor:capacity', 'GuideStep', '손실 감내·집중도 확인', { order: 4, instruction: '생활에 필요한 돈은 사용하지 않고, 한 사업체에 집중하지 않으며 정보 부족과 회수 지연 가능성을 확인합니다.' }),
  node('investor:commit', 'GuideStep', '위험 동의 후 참여', { order: 5, instruction: '1,000원 단위와 개인별 한도 안에서 참여하고, 실제 결제·예치 연결 여부를 확인합니다.' }),
  node('investor:monitor', 'GuideStep', '모집·집행 추적', { order: 6, instruction: '최소 성립조건, 중요 변경, 마일스톤 증빙과 운영자 승인, 쿠폰 적립을 계속 확인합니다.' }),
  node('investor:exit', 'GuideStep', '회수 요청', { order: 7, instruction: '모집 중에는 규칙에 따라 회수하고, 모집 종료 후에는 신규 투자 예약과 FIFO로 매칭될 때까지 기다립니다.' })
];

const INVESTOR_EDGES = [
  edge('investor:start', 'NEXT', 'investor:learn'), edge('investor:learn', 'NEXT', 'investor:review'),
  edge('investor:review', 'NEXT', 'investor:capacity'), edge('investor:capacity', 'NEXT', 'investor:commit'),
  edge('investor:commit', 'NEXT', 'investor:monitor'), edge('investor:monitor', 'NEXT', 'investor:exit')
];

const OWNER_PROCESS = [
  node('owner:start', 'GuideStep', '모집 준비 시작', { order: 1, instruction: '소상공인 계정으로 로그인합니다.' }),
  node('owner:business', 'GuideStep', '사업체·대표자 등록', { order: 2, instruction: '사업자번호, 대표자, 개업일, 영업신고, 사업장 주소와 소개를 등록합니다.' }),
  node('owner:claims', 'GuideStep', '재무 수치 주장 입력', { order: 3, instruction: '6개월 매출, 현금흐름, 부채, 상환액, 비용을 입력합니다. 이 단계의 값은 아직 검증된 사실이 아닙니다.' }),
  node('owner:documents', 'GuideStep', '근거자료 업로드', { order: 4, instruction: 'POS·카드매출 내역, 부채·상환 내역, 납세증명 등 입력값을 입증할 이미지를 올립니다.' }),
  node('owner:orchestration', 'GuideStep', 'AI 교차검증', { order: 5, instruction: 'OCR이 문서별 항목을 추출하고 사업자번호·기간·금액·중복·누락을 순서대로 대조합니다.' }),
  node('owner:adminReview', 'GuideStep', '운영자 원본 확인', { order: 6, instruction: 'AI가 준비 완료로 표시해도 운영자가 원본과 불일치를 확인해야 공식 재무심사가 됩니다.' }),
  node('owner:campaign', 'GuideStep', '모집안·공시 작성', { order: 7, instruction: '자금 용도, 목표금액, 위험 대응, 공개항목 6개와 합계 100%의 지급단계를 작성합니다.' }),
  node('owner:publish', 'GuideStep', '모집 심사·공개', { order: 8, instruction: '공식 재무검증과 운영자 모집심사를 통과한 뒤 투자자에게 공개됩니다.' }),
  node('owner:evidence', 'GuideStep', '집행 증빙 제출', { order: 9, instruction: '공개 후 현재 마일스톤의 계약서·세금계산서·영수증·완료사진을 제출합니다.' })
];

const OWNER_EDGES = [
  edge('owner:start', 'NEXT', 'owner:business'), edge('owner:business', 'NEXT', 'owner:claims'),
  edge('owner:claims', 'REQUIRES', 'owner:documents'), edge('owner:documents', 'VERIFIED_BY', 'owner:orchestration'),
  edge('owner:orchestration', 'REVIEWED_BY', 'owner:adminReview'), edge('owner:adminReview', 'UNLOCKS', 'owner:campaign'),
  edge('owner:campaign', 'SUBMITTED_FOR', 'owner:publish'), edge('owner:publish', 'REQUIRES_AFTER_PUBLICATION', 'owner:evidence')
];

function dynamicInvestorGraph(campaign, area, portfolio = []) {
  if (!campaign) return { nodes: [], edges: [] };
  const businessId = `business:${campaign.business?.id || campaign.businessId || campaign.id}`;
  const campaignId = `campaign:${campaign.id}`;
  const nodes = [
    node(businessId, 'Business', campaign.business?.name || '선택 사업체', {
      category: campaign.business?.category, address: campaign.business?.address,
      verificationStatus: campaign.business?.verificationStatus
    }, 'BUSINESS_RECORD'),
    node(campaignId, 'FundingCampaign', campaign.name, {
      target: campaign.target, currentAmount: campaign.currentAmount || campaign.escrowTotal,
      fundStatus: campaign.fundStatus || campaign.status, risk: campaign.risk
    }, 'CAMPAIGN_RECORD')
  ];
  const edges = [edge(businessId, 'RAISES', campaignId), edge('investor:review', 'EXAMINES', campaignId)];
  if (campaign.assessment) {
    const id = `assessment:${campaign.assessment.id || campaign.businessId}`;
    nodes.push(node(id, 'CreditAssessment', `${campaign.assessment.grade || ''} ${campaign.assessment.score}점`, {
      official: Boolean(campaign.assessment.isOfficial), riskLevel: campaign.assessment.riskLevel,
      fundingLimit: campaign.assessment.fundingLimit, components: campaign.assessment.components
    }, campaign.assessment.isOfficial ? 'APPROVED_FINANCIAL_VERIFICATION' : 'PROVISIONAL_ASSESSMENT'));
    edges.push(edge(businessId, 'ASSESSED_BY', id), edge('investor:review', 'USES', id));
  }
  if (area) {
    const id = `area:${area.areaCode}`;
    nodes.push(node(id, 'CommercialArea', area.areaName, {
      dailyFootTraffic: area.dailyFootTraffic, growthRate: area.growthRate,
      competitorDensity: area.competitorDensity, closureRate: area.closureRate
    }, 'COMMERCIAL_AREA_DATA'));
    edges.push(edge(businessId, 'LOCATED_IN', id));
  }
  (campaign.milestones || []).forEach(item => {
    const id = `milestone:${item.id}`;
    nodes.push(node(id, 'Milestone', item.title, { condition: item.condition, percent: item.percent, status: item.status }, 'CAMPAIGN_MILESTONE'));
    edges.push(edge(campaignId, 'HAS_MILESTONE', id));
  });
  portfolio.filter(item => item.campaignId === campaign.id).forEach(item => {
    const id = `holding:${item.id}`;
    nodes.push(node(id, 'InvestorHolding', '내 투자잔액', { amount: item.investedAmount, accruedDiscount: item.accruedDiscount }, 'INVESTOR_PORTFOLIO'));
    edges.push(edge(id, 'INVESTED_IN', campaignId));
  });
  return { nodes, edges };
}

function dynamicOwnerGraph(owner = {}, area = null) {
  const nodes = [];
  const edges = [];
  const business = owner.business;
  if (business) {
    const id = `business:${business.id}`;
    nodes.push(node(id, 'Business', business.name, {
      verificationStatus: business.verificationStatus, address: business.address, category: business.category
    }, 'OWNER_BUSINESS_RECORD'));
    edges.push(edge('owner:business', 'CREATES', id));
    if (area) {
      const areaId = `area:${area.areaCode}`;
      nodes.push(node(areaId, 'CommercialArea', area.areaName, {
        growthRate: area.growthRate, localSalesGrowth: area.localSalesGrowth,
        competitorDensity: area.competitorDensity, closureRate: area.closureRate
      }, 'COMMERCIAL_AREA_DATA'));
      edges.push(edge(id, 'LOCATED_IN', areaId));
    }
  }
  if (owner.metrics) {
    const id = `metrics:${business?.id || 'current'}`;
    nodes.push(node(id, 'FinancialClaim', '사업자가 입력한 재무·위험 수치', {
      verificationStatus: owner.metrics.verification_status || 'owner_claimed',
      sales6m: owner.metrics.sales_6m, debtTotal: owner.metrics.debt_total,
      monthlyDebtPayment: owner.metrics.monthly_debt_payment
    }, 'OWNER_CLAIM'));
    edges.push(edge(`business:${business?.id}`, 'CLAIMS', id), edge(id, 'REQUIRES', 'owner:documents'));
  }
  if (owner.financialVerification) {
    const id = `financial-verification:${owner.financialVerification.id}`;
    nodes.push(node(id, 'VerificationRun', '재무자료 AI 교차검증', {
      status: owner.financialVerification.status,
      mismatches: owner.financialVerification.orchestration?.mismatches || [],
      missingDocuments: owner.financialVerification.orchestration?.missingDocuments || []
    }, 'FINANCIAL_VERIFICATION_RUN'));
    edges.push(edge('owner:orchestration', 'PRODUCES', id), edge(id, 'REVIEWED_BY', 'owner:adminReview'));
  }
  if (owner.campaign) {
    const id = `campaign:${owner.campaign.id}`;
    nodes.push(node(id, 'FundingCampaign', owner.campaign.name, {
      status: owner.campaign.status, target: owner.campaign.target,
      milestones: owner.campaign.milestones?.length || 0
    }, 'OWNER_CAMPAIGN_RECORD'));
    edges.push(edge(`business:${business?.id}`, 'RAISES', id), edge('owner:campaign', 'CREATES', id));
  }
  return { nodes, edges };
}

export function buildRoleKnowledgeGraph({ role = 'investor', campaign = null, owner = {}, area = null, portfolio = [] } = {}) {
  const isOwner = role === 'owner';
  const baseNodes = isOwner ? OWNER_PROCESS : INVESTOR_PROCESS;
  const baseEdges = isOwner ? OWNER_EDGES : INVESTOR_EDGES;
  const dynamic = isOwner ? dynamicOwnerGraph(owner, area) : dynamicInvestorGraph(campaign, area, portfolio);
  return {
    graphVersion: 'moa-role-graph-v1',
    role: isOwner ? 'owner' : 'investor',
    generatedAt: new Date().toISOString(),
    nodes: [...baseNodes, ...dynamic.nodes],
    edges: [...baseEdges, ...dynamic.edges]
  };
}

export function serializeKnowledgeGraph(graph, question = '') {
  const terms = String(question).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(term => term.length > 1);
  const scored = (graph?.nodes || []).map(item => {
    const haystack = `${item.label} ${JSON.stringify(item.properties)}`.toLowerCase();
    return { item, score: terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0) };
  }).sort((a, b) => b.score - a.score);
  const selected = scored.filter(item => item.score > 0).slice(0, 14);
  const nodes = (selected.length ? selected : scored.slice(0, 12)).map(item => item.item);
  const ids = new Set(nodes.map(item => item.id));
  const edges = (graph?.edges || []).filter(item => ids.has(item.from) || ids.has(item.to)).slice(0, 24);
  return JSON.stringify({ graphVersion: graph?.graphVersion, role: graph?.role, nodes, edges });
}

export function isRoleProcessQuestion(question = '') {
  return /(?:어떻게|어떤\s*식|순서|절차|준비|등록|업로드|시작|방법|하려면)/.test(String(question));
}

export function answerRoleProcessQuestion(question, graph) {
  if (!graph || !isRoleProcessQuestion(question)) return '';
  const steps = graph.nodes.filter(item => item.type === 'GuideStep')
    .sort((a, b) => Number(a.properties.order) - Number(b.properties.order));
  const requestedUpload = /(?:자료|서류|준비|업로드|등록)/.test(question);
  const selected = requestedUpload && graph.role === 'owner'
    ? steps.filter(item => Number(item.properties.order) >= 2 && Number(item.properties.order) <= 7)
    : steps;
  const title = graph.role === 'owner' ? '소상공인 모집 준비 순서' : '투자자 참여 순서';
  return [title, ...selected.map((item, index) => `${index + 1}. ${item.label}: ${item.properties.instruction}`), '',
    '위 답변은 모아 역할별 지식그래프와 현재 저장 상태를 따라 생성됐습니다. 실제 금전 거래 전에는 상품 구조와 결제·예치 연결 상태를 다시 확인하세요.'].join('\n');
}
