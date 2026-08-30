const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

export const ASSESSMENT_BASELINE = 60;
export const ASSESSMENT_WEIGHTS = Object.freeze({
  '매출 지속성': .25,
  '현금흐름 여력': .25,
  '부채 부담': .2,
  '사업 운영 안정성': .15,
  '상권 회복력': .15
});

export function scoreContributions(components = {}, baseline = ASSESSMENT_BASELINE) {
  return Object.entries(ASSESSMENT_WEIGHTS).map(([label, weight]) => {
    const componentScore = finite(components[label]);
    return {
      label,
      componentScore,
      weight,
      contribution: Number(((componentScore - baseline) * weight).toFixed(1))
    };
  });
}

/**
 * A transparent pre-screening heuristic, not a trained probability-of-default model.
 * It only uses fields the service currently receives and keeps the decomposition exact.
 */
export function assessMetrics(body = {}, business = {}) {
  const sales = Array.isArray(body.sales6m) ? body.sales6m.map(finite) : [];
  const averageSales = mean(sales);
  const growth = sales.length > 1 && sales[0] > 0 ? (sales.at(-1) / sales[0] - 1) * 100 : 0;
  const variance = mean(sales.map(value => Math.pow(value - averageSales, 2)));
  const salesVolatility = averageSales > 0 ? Math.sqrt(variance) / averageSales : 1;
  const operatingCashFlow = finite(body.operatingCashFlow);
  const monthlyDebtPayment = finite(body.monthlyDebtPayment);
  const cashCoverage = operatingCashFlow / Math.max(monthlyDebtPayment, 1);
  const operatingMargin = operatingCashFlow / Math.max(averageSales, 1);
  const annualSales = Math.max(finite(business.sales) * 12, averageSales * 12, 1);
  const debtRatio = finite(body.debtTotal) / annualSales;

  const components = {
    '매출 지속성': Number(clamp(60 + growth * .9 - Math.max(0, salesVolatility - .12) * 80).toFixed(1)),
    '현금흐름 여력': Number(clamp(38 + cashCoverage * 14 + operatingMargin * 70).toFixed(1)),
    '부채 부담': Number(clamp(90 - debtRatio * 35 - finite(body.overdueCount) * 20).toFixed(1)),
    '사업 운영 안정성': Number(clamp(45 + finite(business.age) * 5 + (body.taxCompliant ? 12 : -25)
      - finite(body.administrativeActionCount) * 10 - finite(body.representativeChangeCount) * 6).toFixed(1)),
    '상권 회복력': Number(clamp(58 + finite(body.footTrafficGrowth) * 1.3
      + finite(body.localSalesGrowth) * 1.1 - finite(body.closureRate) * 1.1).toFixed(1))
  };
  const contributions = scoreContributions(components);
  const score = Number((ASSESSMENT_BASELINE
    + contributions.reduce((sum, item) => sum + item.contribution, 0)).toFixed(1));
  const missing = [];
  if (!business.number) missing.push('사업자등록 확인');
  if (!sales.some(Number)) missing.push('최근 매출');
  if (finite(body.employeeCount) === 0) missing.push('고용 현황 확인');

  const density = finite(body.competitorDensity);
  const contextualAlerts = [];
  if (density > 0) {
    contextualAlerts.push({
      code: 'competition_density_nonlinear',
      label: `경쟁밀도 ${density.toFixed(2)}`,
      detail: '음식점 밀도의 폐업 영향은 상권 유형별로 비선형이므로, 교정된 지역 모형 없이 일방향 가감점하지 않습니다.'
    });
  }

  return {
    score: clamp(score),
    riskLevel: score >= 75 ? 'low' : score >= 55 ? 'review' : 'high',
    fundingLimit: Math.floor(Math.max(0, finite(business.sales) * (score / 100)) / 100000) * 100000,
    components,
    contributions,
    missing,
    grade: score >= 80 ? 'S2' : score >= 70 ? 'S3' : score >= 60 ? 'S4' : score >= 50 ? 'S5' : 'S7',
    diagnostics: {
      averageSales: Math.round(averageSales),
      salesGrowthRate: Number(growth.toFixed(1)),
      salesVolatility: Number(salesVolatility.toFixed(3)),
      cashCoverage: Number(cashCoverage.toFixed(2)),
      operatingMargin: Number(operatingMargin.toFixed(3)),
      debtToAnnualSales: Number(debtRatio.toFixed(3)),
      contextualAlerts
    },
    methodology: {
      type: 'transparent_additive_prescreen',
      baseline: ASSESSMENT_BASELINE,
      calibratedProbability: false,
      modelVersion: 'moa-risk-v4-research-heuristic'
    }
  };
}
