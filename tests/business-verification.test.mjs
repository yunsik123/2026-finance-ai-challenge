import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyBusiness } from '../src/business-verification.js';

test('Mock 사업자 검증은 향후 외부 API로 교체 가능한 결과 구조를 반환한다', async () => {
  const result = await verifyBusiness({
    number: '123-45-67890', representativeName: '홍길동',
    restaurantLicenseConfirmed: true, applicantIsRepresentative: true
  });
  assert.equal(result.provider, 'mock-v1');
  assert.equal(result.verified, true);
  assert.equal(result.checks.businessNumberFormat, true);
});
