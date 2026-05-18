const CHECKOUT_GOAL_PATTERN = /checkout|payment|cart|order|결제|주문|장바구니|카트/i;

export const plannerSemantics = {
  checkoutGoal: CHECKOUT_GOAL_PATTERN,
  cookieAccept: /accept|agree|allow all|confirm|동의|허용|확인/i,
  cookieContext: /cookie|cookies|쿠키|개인정보|privacy/i,
  consentAccept: /accept|agree|allow|confirm|ok|동의|허용|확인/i,
  consentContext: /consent|privacy|analytics|tracking|telemetry|usage|statistics|cookie|cookies|동의|개인정보|통계|수집|사용 기록|기능 사용|서비스 개선|개인 식별|철회|쿠키/i,
  consentDeferOrReject: /later|not now|decline|reject|deny|dismiss|cancel|close|나중|거부|동의 안|취소|닫기/i,
  marketingConsentContext: /marketing|advertising|promotion|newsletter|마케팅|광고|프로모션|혜택|뉴스레터|메일 수신/i,
  popupDismiss: /close|dismiss|닫기|확인|오늘 하루 보이지 않음|오늘 하루 보지 않기|하루 보이지 않음|하루 보지 않기/i,
  popupContext: /popup|pop|layer|notice|modal|dialog|banner|공지|이벤트|팝업|레이어/i,
  addToCart: /add to cart|add to basket|장바구니 담기|카트 담기|담기/i,
  cartNavigation: /view cart|go to cart|cart|basket|장바구니|카트/i,
  checkoutNavigation: /checkout|proceed to checkout|payment|billing|shipping|order|결제|배송|주문서|주문하기/i
} as const;

export const policySemantics = {
  checkoutNavigation: /checkout|proceed to checkout|payment|billing|shipping|결제|배송|주문서/i,
  cartMutation: /add to cart|add to basket|장바구니 담기|카트 담기|담기|cart add|basket add/i,
  shippingForm: /shipping|delivery|address|postal|zip|recipient|phone|배송|주소|우편번호|수령|연락처|전화/i,
  paymentInfo: /card|credit|cvc|cvv|expiry|expiration|payment info|카드|신용카드|유효기간|결제정보/i,
  finalCommit: /pay now|place order|complete order|submit order|confirm purchase|결제하기|주문하기|구매하기|최종 결제|결제 완료/i,
  destructive: /delete|remove account|cancel subscription|destroy|탈퇴|삭제|구독 취소|회원 탈퇴/i,
  externalMessage: /send message|submit inquiry|contact us|문의 보내기|상담 신청|메시지 전송/i
} as const;

export const verifierSemantics = {
  checkoutGoal: CHECKOUT_GOAL_PATTERN,
  successUrl: /signup|register|join|contact|pricing|checkout|start|demo|apply|inquiry|consult|회원|가입|문의|가격|결제|신청|상담/i,
  checkoutEntry: /checkout|payment|billing|shipping|order|결제|배송|주문/i,
  finalCommit: policySemantics.finalCommit,
  loginWall: /login|log in|sign in|signin|account login|로그인|계정 로그인/i,
  captcha: /captcha|recaptcha|hcaptcha|bot detection|robot check|verify you are human|비정상|자동화|로봇|보안문자|캡차/i
} as const;
