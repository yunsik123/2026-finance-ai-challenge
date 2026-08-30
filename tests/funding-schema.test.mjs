import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const schema = fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');

test('투자·회수 상태 변경은 브라우저 PATCH가 아닌 보안 RPC로 정의한다', () => {
  for (const name of ['invest_fund', 'withdraw_fund', 'process_fund_matching', 'issue_accrued_coupon', 'use_coupon']) {
    assert.match(schema, new RegExp(`function public\\.${name}\\(`));
  }
  assert.match(schema, /security definer set search_path =? ?public/);
});

test('FIFO 매칭은 펀드 잠금, 행 잠금, 1,000원 단위를 강제한다', () => {
  const matching = schema.slice(schema.indexOf('function public.process_fund_matching'), schema.indexOf('function public.invest_fund'));
  assert.match(matching, /pg_advisory_xact_lock/);
  assert.match(matching, /order by created_at, id for update skip locked limit 1/g);
  assert.match(matching, /floor\(chunk \/ 1000\.0\) \* 1000/);
  assert.doesNotMatch(matching, /update public\.campaigns set current_amount/);
});

test('투자 한도와 쿠폰 정책은 정책 테이블 값으로 계산한다', () => {
  assert.match(schema, /max_investment_ratio/);
  assert.match(schema, /daily_coupon_growth_rate/);
  assert.match(schema, /coupon_trade_max_diff/);
  assert.match(schema, /sales_growth_bonus_multiplier/);
});
