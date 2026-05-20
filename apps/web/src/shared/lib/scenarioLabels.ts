export const SCENARIO_LABELS: Record<string, string> = {
  'landing-cta': '랜딩 전환 버튼 점검',
  'signup-form': '가입 / 리드 양식 점검',
  contact: '문의 / 상담 신청 흐름 점검',
  pricing: '가격 / 요금제 흐름 점검',
  checkout: '구매 / 결제 흐름 점검',
};

const SCENARIO_TYPE_LABELS: Record<string, string> = {
  LANDING_CTA: SCENARIO_LABELS['landing-cta'],
  SIGNUP_LEAD_FORM: SCENARIO_LABELS['signup-form'],
  CONTACT: SCENARIO_LABELS.contact,
  PRICING: SCENARIO_LABELS.pricing,
  PURCHASE_CHECKOUT: SCENARIO_LABELS.checkout,
};

function cleanFallbackLabel(label: string | null | undefined) {
  const text = label?.trim();
  return text || null;
}

export function getScenarioLabel(scenario: string | null | undefined, fallbackLabel?: string | null) {
  const key = scenario?.trim();
  if (key) {
    const label = SCENARIO_LABELS[key] ?? SCENARIO_TYPE_LABELS[key];
    if (label) {
      return label;
    }
  }

  return cleanFallbackLabel(fallbackLabel) ?? SCENARIO_LABELS['landing-cta'];
}
