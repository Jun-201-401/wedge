export function getScenarioLabel(scenario: string | null) {
  if (scenario === 'signup-form') {
    return '가입 / 문의 Form 점검';
  }

  if (scenario === 'checkout') {
    return '구매 / 결제 흐름 점검';
  }

  return '랜딩 전환 CTA 점검';
}
