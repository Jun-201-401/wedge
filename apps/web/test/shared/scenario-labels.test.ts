import assert from 'node:assert/strict';
import test from 'node:test';

import { getScenarioLabel } from '../../src/shared/lib/scenarioLabels';

test('getScenarioLabel maps create-analysis scenario ids to user-facing titles', () => {
  assert.equal(getScenarioLabel('landing-cta'), '랜딩 전환 버튼 점검');
  assert.equal(getScenarioLabel('signup-form'), '가입 / 리드 양식 점검');
  assert.equal(getScenarioLabel('contact'), '문의 / 상담 신청 흐름 점검');
  assert.equal(getScenarioLabel('pricing'), '가격 / 요금제 흐름 점검');
  assert.equal(getScenarioLabel('checkout'), '구매 / 결제 흐름 점검');
});

test('getScenarioLabel accepts persisted scenario type keys from evidence payloads', () => {
  assert.equal(getScenarioLabel('LANDING_CTA'), '랜딩 전환 버튼 점검');
  assert.equal(getScenarioLabel('SIGNUP_LEAD_FORM'), '가입 / 리드 양식 점검');
  assert.equal(getScenarioLabel('CONTACT'), '문의 / 상담 신청 흐름 점검');
  assert.equal(getScenarioLabel('PRICING'), '가격 / 요금제 흐름 점검');
  assert.equal(getScenarioLabel('PURCHASE_CHECKOUT'), '구매 / 결제 흐름 점검');
});

test('getScenarioLabel uses caller fallback before defaulting to landing', () => {
  assert.equal(getScenarioLabel(null, '문의 / 상담 신청 흐름 점검'), '문의 / 상담 신청 흐름 점검');
  assert.equal(getScenarioLabel('unknown-scenario', '가격 / 요금제 흐름 점검'), '가격 / 요금제 흐름 점검');
  assert.equal(getScenarioLabel(null), '랜딩 전환 버튼 점검');
});
