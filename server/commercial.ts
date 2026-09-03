// 상권분석 모듈 (소상공인 프로젝트의 commercial_area 패키지를 먹투에 이식).
//
// 식당 주소(지역·동)로 상권을 찾아 유동인구·경쟁밀도·폐업률·임대료를 붙인다.
// 이 값은 세 곳에서 쓰인다.
//   ① 위험평가의 '상권 회복력' 구성요소 — 추정치 대신 상권 원천지표로 계산
//   ② 역할별 지식그래프의 CommercialArea 노드 — AI가 근거로 인용
//   ③ 식당 상세·검증 데이터룸의 입지 분석 카드
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const dataFile = path.join(here, '..', 'data', 'commercial-areas.json')

export interface CommercialArea {
  areaCode: string
  region: string
  areaName: string
  aliases: string[]
  summary: string
  latitude: number | null
  longitude: number | null
  footTraffic: {
    dailyAverage: number
    growthRate: number
    peakTimes: string[]
    weekdayRatio: number
    weekendRatio: number
    /** 일부 상권은 공개 원자료에 연령·성별 분포가 없다. */
    ageDistribution?: Record<string, number>
    genderRatio?: { male: number; female: number }
  }
  demographics: {
    workerPopulation: number
    residentPopulation: number
    primaryCustomerProfile: string
    transitAccessibility: string
  }
  marketDynamics: {
    totalStores: number
    foodBeverageRatio: number
    /** 업종별 경쟁점포 수는 상권마다 공개 여부가 다르다. */
    categoryCompetitorCount?: Record<string, number>
    competitorDensity: number
    closureRate: number
    averageLifespanYears: number
  }
  spending: {
    averageTicketSize: number
    localSalesGrowth: number
    externalConsumerRatio: number
    peakSpendingDay: string
  }
  realEstate: {
    averageRentPerPyung: number
    rentGrowthRate: number
    gentrificationRisk: string
  }
}

type Dataset = { source: string; note: string; areas: Record<string, CommercialArea> }

const dataset: Dataset = JSON.parse(fs.readFileSync(dataFile, 'utf8'))
export const COMMERCIAL_SOURCE = dataset.source
export const COMMERCIAL_NOTE = dataset.note
export const commercialAreas = Object.values(dataset.areas)

/**
 * 동 이름을 먼저 보고, 없으면 시·구 단위로 찾는다.
 * 짐작으로 아무 상권이나 붙이지 않는다 — 못 찾으면 undefined 를 돌려주고
 * 화면과 평가 모형은 "상권 원천데이터 미연동"으로 처리한다.
 */
export function findCommercialArea(place: { neighborhood?: string; region?: string }) {
  const neighborhood = String(place.neighborhood || '').trim()
  const region = String(place.region || '').trim()
  const matches = (area: CommercialArea, needle: string) =>
    Boolean(needle) && area.aliases.some((alias) => needle.includes(alias) || alias.includes(needle))

  const exact = commercialAreas.find((area) => matches(area, neighborhood))
  if (exact) return { area: exact, matchLevel: 'exact' as const }
  const nearby = commercialAreas.find((area) => matches(area, region))
  if (nearby) return { area: nearby, matchLevel: 'nearby' as const }
  return undefined
}

const grade = (value: number, good: number, watch: number) => value <= good ? '안정' : value <= watch ? '관찰' : '주의'

/** 투자자가 바로 읽을 수 있는 기회·주의 문장. */
export function commercialInsight(area: CommercialArea, category = '') {
  const competitors = area.marketDynamics.categoryCompetitorCount?.[category]
  const competition = area.marketDynamics.competitorDensity >= .75 ? '높음'
    : area.marketDynamics.competitorDensity >= .6 ? '보통' : '낮음'
  const demandFit = competitors !== undefined
    ? `이 상권에 ${category} 업종이 ${competitors.toLocaleString('ko-KR')}곳 있습니다.`
    : area.spending.externalConsumerRatio >= 70
      ? '외지 방문 소비 비중이 높아 주말·방문 수요를 기대할 수 있습니다.'
      : '배후 직장인·주민의 반복 이용 수요가 중심인 상권입니다.'
  return {
    competition,
    stability: grade(area.marketDynamics.closureRate, 9, 12),
    opportunity: `${demandFit} 일 유동인구 ${area.footTraffic.dailyAverage.toLocaleString('ko-KR')}명, 상권 매출 증가율 ${area.spending.localSalesGrowth}%입니다.`,
    caution: area.marketDynamics.closureRate >= 12
      ? `주변 폐업률이 ${area.marketDynamics.closureRate}%로 높아 임대료·원가와 실제 생존기간을 함께 확인해야 합니다.`
      : area.marketDynamics.competitorDensity >= .7
        ? `경쟁 밀도가 ${area.marketDynamics.competitorDensity}로 높아 단골률과 차별화 증빙을 확인해야 합니다.`
        : `폐업률은 ${area.marketDynamics.closureRate}%지만 임대료 상승(${area.realEstate.rentGrowthRate}%/년)과 계절 변동은 별도로 봐야 합니다.`,
    gentrification: area.realEstate.gentrificationRisk,
  }
}

/**
 * 위험평가의 '상권 회복력' 점수.
 * 유동인구 성장 · 상권 매출 성장을 더하고, 폐업률 · 경쟁밀도 · 임대료 상승을 뺀다.
 */
export function commercialResilience(area: CommercialArea) {
  const raw = 58
    + area.footTraffic.growthRate * 1.3
    + area.spending.localSalesGrowth * 1.1
    - area.marketDynamics.closureRate * 1.1
    - Math.max(0, area.marketDynamics.competitorDensity - .6) * 40
    - Math.max(0, area.realEstate.rentGrowthRate - 4) * 2.5
  return Number(Math.max(0, Math.min(100, raw)).toFixed(1))
}

/** 지식그래프에 넣을 요약. 값이 커지지 않게 핵심 지표만 담는다. */
export function commercialGraphProperties(area: CommercialArea) {
  return {
    areaCode: area.areaCode,
    region: area.region,
    latitude: area.latitude,
    longitude: area.longitude,
    dailyFootTraffic: area.footTraffic.dailyAverage,
    footTrafficGrowth: area.footTraffic.growthRate,
    competitorDensity: area.marketDynamics.competitorDensity,
    closureRate: area.marketDynamics.closureRate,
    localSalesGrowth: area.spending.localSalesGrowth,
    averageTicketSize: area.spending.averageTicketSize,
    rentGrowthRate: area.realEstate.rentGrowthRate,
    primaryCustomer: area.demographics.primaryCustomerProfile,
  }
}
