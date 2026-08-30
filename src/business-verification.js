// 실제 국세청·식품안전 API를 연결할 때 이 어댑터의 구현만 교체한다.
export async function verifyBusiness(input, provider = 'mock-v1') {
  const number = String(input.number || '').replace(/\D/g, '');
  const checks = {
    businessNumberFormat: number.length === 10,
    representativeProvided: Boolean(String(input.representativeName || '').trim()),
    restaurantLicenseConfirmed: Boolean(input.restaurantLicenseConfirmed),
    applicantMatchesRepresentative: Boolean(input.applicantIsRepresentative)
  };
  return {
    provider,
    verified: Object.values(checks).every(Boolean),
    checks,
    checkedAt: new Date().toISOString(),
    message: Object.values(checks).every(Boolean)
      ? 'Demo 형식 검증을 통과했습니다. 운영자가 원본을 확인해야 최종 승인됩니다.'
      : '사업자번호·대표자·영업신고·신청자 일치 항목을 확인해 주세요.'
  };
}
