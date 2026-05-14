import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('create analysis preflight renders an agent-style progress card', () => {
  const source = fs.readFileSync(
    new URL('../../src/pages/create-analysis/CreateAnalysisPage.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /className="create-analysis-panel create-analysis-panel--preflight"/);
  assert.match(source, /className="preflight-agent"/);
  assert.match(source, /className="preflight-agent__header"/);
  assert.doesNotMatch(source, /className="preflight-agent__header-icon"/);
  assert.doesNotMatch(source, /preflight-agent__header-status/);
  assert.match(source, /className="preflight-agent__progress"/);
  assert.match(source, /분석할 흐름을 찾고 있어요/);
  assert.match(source, /formatDisplayUrl/);
  assert.match(source, /const submittedUrlLabel = formatDisplayUrl\(submittedUrl\)/);
  assert.match(source, /className="preflight-agent__url" title=\{submittedUrl\}>\{submittedUrlLabel\}<\/p>/);
  assert.doesNotMatch(source, /className="preflight-agent__scope"/);
  assert.doesNotMatch(source, /전체 분석 전 확인/);
  assert.doesNotMatch(source, /첫 화면과 주요 진입점 중심/);
  assert.doesNotMatch(source, /추천 흐름 자동 정리/);
  assert.match(source, /className="preflight-agent__timeline"/);
  assert.match(source, /preflight-agent__step preflight-agent__step--\$\{step\.status\}/);
  assert.match(source, /className="preflight-agent__rail"/);
  assert.match(source, /className="preflight-agent__node-spinner"/);
  assert.match(source, /className="create-analysis-panel__action preflight-agent__action"/);
  assert.match(source, /onRetry=\{retryDiscovery\}/);
  assert.match(source, /onEditUrl=\{editUrl\}/);
});

test('create analysis top nav links to previous run list beside logout', () => {
  const source = fs.readFileSync(
    new URL('../../src/pages/create-analysis/CreateAnalysisPage.tsx', import.meta.url),
    'utf8',
  );
  const css = fs.readFileSync(
    new URL('../../src/pages/create-analysis/CreateAnalysisPage.css', import.meta.url),
    'utf8',
  );

  assert.match(source, /LOGIN_PATH, RUNS_PATH/);
  assert.match(source, /stage === 'input' \? \(/);
  assert.match(source, /<a href=\{RUNS_PATH\} className="create-analysis-nav__link--secondary">실행 목록<\/a>/);
  assert.match(source, /<a href=\{getLoginPathForCurrentCreateAnalysisState\(\)\}>로그인<\/a>/);
  assert.match(source, /<button type="button" onClick=\{onLogout\}>로그아웃<\/button>/);
  assert.match(css, /\.create-analysis-nav\s*\{[\s\S]*?position: relative/);
  assert.match(css, /\.create-analysis-nav\s*\{[\s\S]*?height: 4rem/);
  assert.match(css, /\.create-analysis-nav\s*\{[\s\S]*?border-bottom: 1px solid rgba\(248, 250, 252, 1\)/);
  assert.match(css, /\.create-analysis-nav\s*\{[\s\S]*?background: rgba\(255, 255, 255, 0\.96\)/);
  assert.match(css, /\.create-analysis-nav\s*\{[\s\S]*?padding: 0 2rem/);
  assert.match(css, /\.create-analysis-page__main\s*\{[\s\S]*?min-height: calc\(100svh - 4rem\)/);
  assert.match(css, /\.create-analysis-nav__actions a,\s*\n\.create-analysis-nav__actions button\s*\{[\s\S]*?display: inline-flex/);
  assert.match(css, /\.create-analysis-nav__actions a,\s*\n\.create-analysis-nav__actions button\s*\{[\s\S]*?height: 2\.05rem/);
  assert.match(css, /\.create-analysis-nav__actions a,\s*\n\.create-analysis-nav__actions button\s*\{[\s\S]*?border: 0/);
  assert.match(css, /\.create-analysis-nav__actions \.create-analysis-nav__link--secondary\s*\{[\s\S]*?border: 0/);
  assert.match(css, /\.create-analysis-nav__actions \.create-analysis-nav__link--secondary\s*\{[\s\S]*?height: 2\.05rem/);
  assert.match(css, /\.create-analysis-nav__actions \.create-analysis-nav__link--secondary\s*\{[\s\S]*?background: rgba\(255, 255, 255, 0\.42\)/);
  assert.match(css, /\.create-analysis-nav__actions \.create-analysis-nav__link--secondary:hover\s*\{[\s\S]*?background: rgba\(240, 249, 255, 0\.82\)/);
  assert.match(css, /@media \(max-width: 640px\) \{[\s\S]*?\.create-analysis-nav\s*\{[\s\S]*?padding: 0 1\.25rem/);
  assert.match(css, /@media \(max-width: 640px\) \{[\s\S]*?\.create-analysis-nav__actions\s*\{[\s\S]*?gap: 0\.5rem/);
  assert.match(css, /@media \(max-width: 640px\) \{[\s\S]*?\.create-analysis-page__main\s*\{[\s\S]*?padding: 1\.25rem/);
  assert.doesNotMatch(source, /create-analysis-previous-runs/);
});

test('create analysis submit sends anonymous users to login before discovery', () => {
  const source = fs.readFileSync(
    new URL('../../src/pages/create-analysis/CreateAnalysisPage.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /function getLoginPathForCreateAnalysisRouteState\(routeState: CreateAnalysisPageRouteState\)/);
  assert.match(source, /function createDiscoveryRouteState\(routeState: CreateAnalysisPageRouteState, submittedUrl: string\)/);
  assert.match(source, /stage: 'discovering',\s*\n\s*submittedUrl,/);
  assert.match(source, /const discoveryRouteState = createDiscoveryRouteState\(routeState, normalizedUrl\)/);
  assert.match(source, /if \(isAuthChecking\) \{[\s\S]*?로그인 상태를 확인하는 중입니다/);
  assert.match(source, /if \(!isAuthenticated\) \{[\s\S]*?pushAppPath\(getLoginPathForCreateAnalysisRouteState\(discoveryRouteState\)\)/);
  assert.match(source, /stage !== 'discovering' \|\| !submittedUrl \|\| isAuthChecking \|\| !isAuthenticated/);
  assert.match(source, /void runDiscovery\(submittedUrl, routeState\)/);
});

test('create analysis preflight css keeps the landing-agent card language', () => {
  const css = fs.readFileSync(
    new URL('../../src/pages/create-analysis/CreateAnalysisPage.css', import.meta.url),
    'utf8',
  );

  assert.match(css, /\.create-analysis-panel--preflight\s*\{[\s\S]*?background: transparent/);
  assert.match(css, /\.preflight-agent,\s*\n\.recommendation-agent,\s*\n\.manual-choice-agent,\s*\n\.scenario-setup-agent,\s*\n\.ready-agent\s*\{[\s\S]*?font-family: 'Pretendard Variable', Pretendard, 'Inter', sans-serif/);
  assert.match(css, /\.preflight-agent,\s*\n\.recommendation-agent,\s*\n\.manual-choice-agent,\s*\n\.scenario-setup-agent,\s*\n\.ready-agent\s*\{[\s\S]*?box-shadow: 0 12px 40px -10px/);
  assert.match(css, /\.preflight-agent__header-copy p,\s*\n\.recommendation-agent__header-copy p,\s*\n\.manual-choice-agent__header-copy p\s*\{[\s\S]*?margin-bottom: 0\.48rem/);
  assert.doesNotMatch(css, /\.preflight-agent__scope/);
  assert.match(css, /\.preflight-agent__step--active \.preflight-agent__content\s*\{[\s\S]*?background: rgba\(248, 250, 252, 0\.5\)/);
  assert.match(css, /@keyframes createAnalysisPreflightFlowData/);
  assert.match(css, /@keyframes createAnalysisPreflightPing/);
});

test('create analysis recommendations use a wider agent-style results card', () => {
  const source = fs.readFileSync(
    new URL('../../src/pages/create-analysis/CreateAnalysisPage.tsx', import.meta.url),
    'utf8',
  );
  const css = fs.readFileSync(
    new URL('../../src/pages/create-analysis/CreateAnalysisPage.css', import.meta.url),
    'utf8',
  );

  assert.match(source, /function RecommendationAgent/);
  assert.match(source, /className="create-analysis-panel create-analysis-panel--recommendations"/);
  assert.match(source, /className="recommendation-agent"/);
  assert.doesNotMatch(source, /className="recommendation-agent__header-icon"/);
  assert.match(source, /진단 흐름 추천/);
  assert.match(source, /const hasDetectedScenarios = detectedScenarioCount > 0/);
  assert.match(source, /hasDetectedScenarios \? '이 사이트에서 점검해볼 만한 흐름을 찾았어요' : '점검할 흐름을 직접 선택해주세요'/);
  assert.doesNotMatch(source, /자동 추천 흐름이 아직 없어요/);
  assert.doesNotMatch(source, /탐색 완료 · 추천 흐름을 선택하세요/);
  assert.match(source, /사이트 화면에서 확인한 버튼, 링크, 폼 신호/);
  assert.match(source, /현재 화면에서 확인한 버튼, 링크, 폼 신호만으로는 바로 실행할 흐름을 고르기 어려워요/);
  assert.match(source, /scenario\.levelLabel/);
  assert.match(source, /className="scenario-card__site-context"/);
  assert.match(source, /추천 근거/);
  assert.match(source, /추천 진입점/);
  assert.match(source, /scenario\.previewSteps\.map/);
  assert.doesNotMatch(source, /scenario-card__confidence/);
  assert.doesNotMatch(source, /scenario-card__limitations/);
  assert.match(source, /recommendation-agent__empty/);
  assert.match(source, /가입, 로그인, 결제 같은 흐름을 직접 고를 수 있어요/);
  assert.match(source, /현재 화면에서 바로 추천할 흐름을 고르기 어려워요\. 다음 화면에서 직접 선택해 진단을 시작하세요/);
  assert.match(source, /className="create-analysis-secondary-action recommendation-agent__empty-action"/);
  assert.match(source, /직접 흐름 선택/);
  assert.doesNotMatch(source, /추천 가능한 흐름을 찾지 못했어요/);
  assert.doesNotMatch(source, /Discovery는/);
  assert.doesNotMatch(source, /Discovery가 실패했습니다/);
  assert.doesNotMatch(source, /Discovery 응답 시간이 초과됐습니다/);
  assert.match(source, /className="recommendation-agent__count"/);
  assert.match(source, /visibleScenarios = scenarios\.filter\(\(scenario\) => scenario\.isRunnable\)/);
  assert.match(source, /className="recommendation-agent__url" title=\{submittedUrl\}>\{submittedUrlLabel\}<\/p>/);
  assert.match(source, /className="manual-choice-agent__url" title=\{submittedUrl\}>\{submittedUrlLabel\}<\/p>/);
  assert.match(source, /onOpenManualChoice/);
  assert.match(source, /hasDetectedScenarios && hasManualScenarios/);
  assert.match(source, /다른 흐름 선택/);
  assert.match(source, /탐지됨/);
  assert.match(source, /onChooseScenario=\{chooseScenario\}/);
  assert.match(source, /onClick=\{\(\) => onChooseScenario\(scenario\)\}/);
  assert.doesNotMatch(source, /disabled=\{!scenario\.isRunnable\}/);

  assert.match(css, /\.create-analysis-panel--recommendations\s*\{[\s\S]*?width: min\(100%, 66rem\)/);
  assert.match(css, /\.create-analysis-panel\s*\{[\s\S]*?box-sizing: border-box/);
  assert.match(css, /\.preflight-agent,\s*\n\.recommendation-agent,\s*\n\.manual-choice-agent,\s*\n\.scenario-setup-agent,\s*\n\.ready-agent\s*\{[\s\S]*?font-family: 'Pretendard Variable', Pretendard, 'Inter', sans-serif/);
  assert.match(css, /\.preflight-agent,\s*\n\.recommendation-agent,\s*\n\.manual-choice-agent,\s*\n\.scenario-setup-agent,\s*\n\.ready-agent\s*\{[\s\S]*?box-sizing: border-box/);
  assert.match(css, /\.preflight-agent,\s*\n\.recommendation-agent,\s*\n\.manual-choice-agent,\s*\n\.scenario-setup-agent,\s*\n\.ready-agent\s*\{[\s\S]*?min-width: 0/);
  assert.match(css, /\.recommendation-agent__limitation\s*\{[\s\S]*?margin: 0\.9rem 0 0/);
  assert.match(css, /\.scenario-grid\s*\{[\s\S]*?width: 100%/);
  assert.match(css, /\.scenario-grid\s*\{[\s\S]*?min-width: 0/);
  assert.match(css, /\.scenario-card,\s*\n\.manual-choice-agent__option\s*\{[\s\S]*?box-sizing: border-box/);
  assert.match(css, /\.scenario-card,\s*\n\.manual-choice-agent__option\s*\{[\s\S]*?width: 100%/);
  assert.match(css, /\.scenario-card,\s*\n\.manual-choice-agent__option\s*\{[\s\S]*?min-width: 0/);
  assert.match(css, /\.scenario-card,\s*\n\.manual-choice-agent__option\s*\{[\s\S]*?border: 0/);
  assert.match(css, /\.scenario-card,\s*\n\.manual-choice-agent__option\s*\{[\s\S]*?background: #f1f5f9/);
  assert.match(css, /\.scenario-card\s*\{[\s\S]*?overflow: hidden/);
  assert.match(css, /\.scenario-card h3\s*\{[\s\S]*?overflow-wrap: anywhere/);
  assert.match(css, /\.scenario-card p\s*\{[\s\S]*?overflow-wrap: anywhere/);
  assert.match(css, /\.recommendation-agent \.scenario-card\s*\{[\s\S]*?height: 100%/);
  assert.match(css, /\.recommendation-agent \.scenario-card > p\s*\{[\s\S]*?min-height: 2\.66rem/);
  assert.match(css, /\.recommendation-agent \.scenario-card > p\s*\{[\s\S]*?-webkit-line-clamp: 2/);
  assert.match(css, /\.recommendation-agent \.scenario-card button\s*\{[\s\S]*?margin-top: auto/);
  assert.match(css, /\.recommendation-agent \.scenario-card button\s*\{[\s\S]*?background: #334155/);
  assert.match(css, /\.create-analysis-panel__action,\s*\n\.scenario-card button\s*\{[\s\S]*?max-width: 100%/);
  assert.match(css, /\.create-analysis-panel__action,\s*\n\.scenario-card button\s*\{[\s\S]*?overflow-wrap: anywhere/);
  assert.match(css, /\.recommendation-agent \.scenario-card > p\s*\{[\s\S]*?margin-bottom: 1\.35rem/);
  assert.match(css, /\.scenario-card__site-context\s*\{[\s\S]*?border: 0/);
  assert.match(css, /\.scenario-card__site-context\s*\{[\s\S]*?background: #e8eef5/);
  assert.match(css, /\.scenario-card__site-context\s*\{[\s\S]*?min-width: 0/);
  assert.match(css, /\.scenario-card__site-context\s*\{[\s\S]*?min-height: 10\.85rem/);
  assert.match(css, /\.scenario-card__site-context\s*\{[\s\S]*?gap: 0\.62rem/);
  assert.match(css, /\.scenario-card__site-context\s*\{[\s\S]*?padding: 0\.88rem 0\.92rem/);
  assert.match(css, /\.scenario-card__context-row\s*\{[\s\S]*?gap: 0\.16rem/);
  assert.match(css, /\.scenario-card__context-row strong\s*\{[\s\S]*?max-width: 100%/);
  assert.match(css, /\.scenario-card__preview-steps li\s*\{[\s\S]*?overflow-wrap: anywhere/);
  assert.doesNotMatch(source, /scenario-card__context-note/);
  assert.doesNotMatch(source, /확인 범위: \{scenario\.limitationLabels\.join/);
  assert.doesNotMatch(css, /scenario-card__context-note/);
  assert.match(css, /\.scenario-card__context-row strong\s*\{[\s\S]*?font-size: 0\.875rem/);
  assert.match(css, /\.scenario-card__preview-steps\s*\{[\s\S]*?font-size: 0\.875rem/);
  assert.match(css, /\.scenario-card__preview-steps\s*\{[\s\S]*?gap: 0\.4rem/);
  assert.match(css, /\.scenario-card__preview-steps\s*\{[\s\S]*?line-height: 1\.5/);
  assert.doesNotMatch(css, /\.recommendation-agent \.scenario-card--recommended\s*\{[\s\S]*?background:/);
  assert.doesNotMatch(css, /\.scenario-grid \.scenario-card:nth-child/);
  assert.doesNotMatch(css, /\.manual-choice-agent__option:nth-child/);
  assert.match(css, /\.recommendation-agent \.scenario-card:hover,\s*\n\.recommendation-agent \.scenario-card:focus-within,\s*\n\.manual-choice-agent__option:hover,\s*\n\.manual-choice-agent__option:focus-visible\s*\{[\s\S]*?box-shadow: 0 14px 30px rgba\(15, 23, 42, 0\.06\)/);
  assert.match(css, /\.recommendation-agent \.scenario-card:hover,\s*\n\.recommendation-agent \.scenario-card:focus-within,\s*\n\.manual-choice-agent__option:hover,\s*\n\.manual-choice-agent__option:focus-visible\s*\{[\s\S]*?border: 0/);
  assert.match(css, /\.recommendation-agent \.scenario-card:hover,\s*\n\.recommendation-agent \.scenario-card:focus-within\s*\{[\s\S]*?background: #eef6fb/);
  assert.match(css, /\.recommendation-agent__empty\s*\{[\s\S]*?border: 0/);
  assert.match(css, /\.recommendation-agent__empty\s*\{[\s\S]*?background: #f8fafc/);
  assert.match(css, /\.recommendation-agent__empty-action\s*\{[\s\S]*?justify-self: flex-end/);
  assert.doesNotMatch(css, /\.scenario-card--available\s*\{/);
  assert.doesNotMatch(css, /\.scenario-card--available \.scenario-card__site-context/);
  assert.doesNotMatch(css, /\.recommendation-agent \.scenario-card--available:hover \.scenario-card__site-context/);
  assert.doesNotMatch(css, /\.recommendation-agent \.scenario-card--available:focus-within \.scenario-card__site-context/);
  assert.match(css, /\.recommendation-agent__manual-entry\s*\{[\s\S]*?border-top: 1px solid rgba\(226, 232, 240, 0\.78\)/);
  assert.doesNotMatch(css, /recommendation-agent__header-status-dot/);
});

test('create analysis manual choice uses a separate low-noise selection screen', () => {
  const source = fs.readFileSync(
    new URL('../../src/pages/create-analysis/CreateAnalysisPage.tsx', import.meta.url),
    'utf8',
  );
  const css = fs.readFileSync(
    new URL('../../src/pages/create-analysis/CreateAnalysisPage.css', import.meta.url),
    'utf8',
  );
  const manualChoiceGridRule = css.match(/\.manual-choice-agent__grid\s*\{[^}]*\}/)?.[0] ?? '';

  assert.match(source, /function ManualChoiceAgent/);
  assert.match(source, /className="create-analysis-panel create-analysis-panel--manual-choice"/);
  assert.match(source, /className="create-analysis-secondary-action manual-choice-agent__back"/);
  assert.doesNotMatch(source, /className="manual-choice-agent__header-icon"/);
  assert.doesNotMatch(source, /manual-choice-agent__header-status/);
  assert.match(source, /점검할 흐름을 직접 고르세요/);
  assert.match(source, /manualChoiceScenarios/);
  assert.match(source, /stage === 'manual-choice'/);
  assert.match(source, /createManualChoiceRouteState\(routeState, submittedUrl\)/);
  assert.match(source, /추천 흐름으로 돌아가기/);

  assert.match(css, /\.create-analysis-panel--manual-choice\s*\{[\s\S]*?width: min\(100%, 58rem\)/);
  assert.match(css, /\.manual-choice-agent__note\s*\{[\s\S]*?margin: 0\.9rem 0 0/);
  assert.match(css, /\.manual-choice-agent__grid\s*\{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(manualChoiceGridRule, /padding:/);
  assert.match(css, /\.manual-choice-agent__option\s*\{[\s\S]*?border-radius: 1\.5rem/);
  assert.doesNotMatch(css, /\.manual-choice-agent__option:nth-child/);
  assert.match(css, /\.manual-choice-agent__option:hover,\s*\n\.manual-choice-agent__option:focus-visible\s*\{[\s\S]*?background: #eef6fb/);
  assert.match(css, /\.scenario-card__level,\s*\n\.manual-choice-agent__option span\s*\{[\s\S]*?background: rgba\(224, 242, 254, 0\.88\)/);
  assert.match(css, /\.create-analysis-secondary-action\s*\{[\s\S]*?background: #334155/);
  assert.match(css, /\.create-analysis-secondary-action\s*\{[\s\S]*?box-shadow: 0 10px 22px rgba\(51, 65, 85, 0\.12\)/);
});

test('create analysis scenario setup uses agent card and accessible depth choices', () => {
  const source = fs.readFileSync(
    new URL('../../src/pages/create-analysis/CreateAnalysisPage.tsx', import.meta.url),
    'utf8',
  );
  const css = fs.readFileSync(
    new URL('../../src/pages/create-analysis/CreateAnalysisPage.css', import.meta.url),
    'utf8',
  );

  assert.match(source, /function ScenarioSetupAgent/);
  assert.match(source, /className="create-analysis-panel create-analysis-panel--onboarding"/);
  assert.match(source, /className="scenario-setup-agent"/);
  assert.match(source, /Scope selection/);
  assert.match(source, /className="scenario-setup-agent__selected-flow"/);
  assert.match(source, /SCENARIO_DEPTH_OPTIONS\.map/);
  assert.match(source, /첫 화면에서 다음 행동이 바로 보이는지 확인해요/);
  assert.match(source, /다음 화면의 맥락까지 이어서 확인해요/);
  assert.match(source, /입력 폼까지 보기/);
  assert.doesNotMatch(source, /CTA가 명확한지, 첫 행동이 바로 보이는지 빠르게 확인합니다/);
  assert.doesNotMatch(source, /Form까지 보기/);
  assert.match(source, /role="radiogroup"/);
  assert.match(source, /checked=\{isSelected\}/);
  assert.match(source, /onChange=\{\(\) => onDepthChange\(option\.id\)\}/);
  assert.match(source, /onReady=\{showReady\}/);

  assert.match(css, /\.create-analysis-panel--onboarding\s*\{[\s\S]*?background: transparent/);
  assert.match(css, /\.scenario-depth-option:has\(input:focus-visible\)\s*\{[\s\S]*?box-shadow: 0 0 0 3px/);
  assert.match(css, /\.scenario-depth-option input:focus-visible \+ \.scenario-depth-option__marker\s*\{[\s\S]*?box-shadow: 0 0 0 3px/);
  assert.match(css, /\.scenario-depth-option--selected\s*\{[\s\S]*?background: rgba\(240, 249, 255, 0\.48\)/);
  assert.match(css, /\.scenario-setup-agent__action\s*\{[\s\S]*?background: #334155/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.scenario-setup-agent__header-status-dot::after[\s\S]*?animation: none/);
});


test('create analysis ready screen uses an agent card layout', () => {
  const source = fs.readFileSync(
    new URL('../../src/pages/create-analysis/CreateAnalysisPage.tsx', import.meta.url),
    'utf8',
  );
  const css = fs.readFileSync(
    new URL('../../src/pages/create-analysis/CreateAnalysisPage.css', import.meta.url),
    'utf8',
  );

  assert.match(source, /function ReadyAgent/);
  assert.match(source, /function getAuthoringPollingStatusText/);
  assert.match(source, /className="create-analysis-panel create-analysis-panel--ready"/);
  assert.match(source, /className="ready-agent"/);
  assert.match(source, /분석 시작 준비 완료/);
  assert.match(source, /case 'QUEUED':[\s\S]*?사이트 맞춤 시나리오 생성 대기 중/);
  assert.match(source, /case 'RUNNING':[\s\S]*?사이트 맞춤 시나리오 생성 중/);
  assert.doesNotMatch(source, /시나리오 생성 중 · \$\{state\.status\}/);
  assert.doesNotMatch(source, /사이트 맞춤 Scenario 생성 대기 중/);
  assert.doesNotMatch(source, /선택한 흐름으로 바로 진단을 시작할 수 있어요/);
  assert.doesNotMatch(source, /ready-agent__header-icon/);
  assert.match(source, /selectedDepth=\{selectedDepth\}/);
  assert.match(source, /className="ready-agent__summary-grid"/);
  assert.match(source, /className="ready-agent__launch-plan"/);
  assert.match(source, /className="ready-agent__scenario-plan"/);
  assert.match(source, /생성된 흐름/);
  assert.match(source, /\{preview\.stepCount\}단계/);
  assert.doesNotMatch(source, /생성된 Scenario/);
  assert.doesNotMatch(source, /\{preview\.stepCount\} steps/);
  assert.match(source, /preview\.steps\.map/);
  assert.match(source, /const previewStartUrlLabel = preview\?\.startUrl \? formatDisplayUrl\(preview\.startUrl\) : ''/);
  assert.match(source, /<strong title=\{submittedUrl\}>\{submittedUrlLabel\}<\/strong>/);
  assert.match(source, /className="ready-agent__scenario-plan-url" title=\{preview\.startUrl\}>\{previewStartUrlLabel\}<\/p>/);
  assert.match(source, /scenarioAuthoringRequestKey/);
  assert.match(source, /stage !== 'ready' \|\| !scenarioAuthoringRequestKey/);

  assert.match(css, /\.create-analysis-panel--ready\s*\{[\s\S]*?width: min\(100%, 48rem\)/);
  assert.match(css, /\.ready-agent__summary-grid\s*\{[\s\S]*?grid-template-columns: 1fr/);
  assert.match(css, /\.ready-agent__summary-card\s*\{[\s\S]*?border: 0/);
  assert.match(css, /\.ready-agent__summary-card\s*\{[\s\S]*?background: rgba\(255, 255, 255, 0\.96\)/);
  assert.match(css, /\.ready-agent__launch-plan\s*\{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.ready-agent__scenario-plan\s*\{[\s\S]*?border: 0/);
  assert.match(css, /\.ready-agent__scenario-plan\s*\{[\s\S]*?background: rgba\(240, 249, 255, 0\.88\)/);
  assert.match(css, /\.ready-agent__scenario-plan\s*\{[\s\S]*?transition: box-shadow 0\.2s ease, transform 0\.2s ease/);
  assert.match(css, /\.ready-agent__scenario-plan:hover,\s*\n\.ready-agent__scenario-plan:focus-within\s*\{[\s\S]*?transform: translateY\(-1px\)/);
  assert.match(css, /\.ready-agent__scenario-steps strong\s*\{[\s\S]*?font-size: 0\.875rem/);
  assert.match(css, /\.ready-agent__scenario-steps p\s*\{[\s\S]*?font-size: 0\.875rem/);
  assert.match(css, /\.ready-agent__scenario-steps p\s*\{[\s\S]*?line-height: 1\.5/);
  assert.doesNotMatch(css, /\.ready-agent__scenario-plan\s*\{[\s\S]*?background: linear-gradient/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.ready-agent__header-status-dot::after[\s\S]*?animation: none/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.ready-agent__scenario-plan[\s\S]*?transition-duration: 0\.01ms/);
});

test('create analysis ready safety setting uses a muted notice block', () => {
  const source = fs.readFileSync(
    new URL('../../src/pages/create-analysis/CreateAnalysisPage.tsx', import.meta.url),
    'utf8',
  );
  const css = fs.readFileSync(
    new URL('../../src/pages/create-analysis/CreateAnalysisPage.css', import.meta.url),
    'utf8',
  );

  assert.match(source, /className="ready-agent__notice"/);
  assert.match(source, /안전 설정/);
  assert.match(source, /안전하게 탐색합니다/);
  assert.match(source, /실제 결제, 삭제, 변경 같은 위험 행동은 수행하지 않아요\./);
  assert.doesNotMatch(source, /ready-agent__summary-card--safety/);

  assert.match(css, /\.ready-agent__notice\s*\{[\s\S]*?background: rgba\(248, 250, 252, 0\.76\)/);
  assert.match(css, /\.ready-agent__notice strong\s*\{[\s\S]*?font-weight: 700/);
  assert.match(css, /\.ready-agent__notice p\s*\{[\s\S]*?font-size: 0\.8rem/);
  assert.doesNotMatch(css, /ready-agent__summary-card--safety/);
});

test('create analysis ready run controls remain wired', () => {
  const source = fs.readFileSync(
    new URL('../../src/pages/create-analysis/CreateAnalysisPage.tsx', import.meta.url),
    'utf8',
  );
  const css = fs.readFileSync(
    new URL('../../src/pages/create-analysis/CreateAnalysisPage.css', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ createDiscovery, getDiscovery \} from '..\/..\/api\/discoveries'/);
  assert.match(source, /import \{ createRun, startRun \} from '..\/..\/api\/runs'/);
  assert.match(source, /import \{ buildRunMonitorPath \}/);
  assert.doesNotMatch(source, /buildMockRunId/);
  assert.match(source, /getCreateRunIds/);
  assert.match(source, /const createRunIds = useMemo/);
  assert.doesNotMatch(source, /MVP_SMOKE_CREATE_RUN_CONTEXT/);
  assert.match(source, /const ENV_CREATE_RUN_CONTEXT = readCreateRunContextFromEnv\(import\.meta\.env\)/);
  assert.match(source, /withCreateRunContextFallback/);
  assert.match(source, /withoutCreateRunContext/);
  assert.match(source, /function clearCreateRunContext/);
  assert.match(source, /projectId: createRunIds\.projectId/);
  assert.match(source, /scenarioTemplateVersionId: scenarioPlan \? createRunIds\.scenarioTemplateVersionId : undefined/);
  assert.doesNotMatch(source, /import \{ buildPrototypeScenarioPlan \}/);
  assert.match(source, /scenarioPlan: scenarioPlan \?\? undefined/);
  assert.match(source, /sourceAuthoringJobId/);
  assert.match(source, /createAndConfirmScenarioPlan/);
  assert.match(source, /createScenarioAuthoringJob/);
  assert.match(source, /isCreatingRun=\{isCreatingRun \|\| scenarioAuthoringBusy\}/);
  assert.match(source, /selectedDepthId/);
  assert.match(source, /source: 'create-analysis-agent-ready'/);
  assert.match(source, /const runStartUrl = scenarioPlan \? requireConfirmedScenarioPlanStartUrl\(scenarioPlan\) : selectedScenario\.suggestedStartUrl \?\? submittedUrl/);
  assert.match(source, /sourceDiscoveryId: selectedScenario\.sourceDiscoveryId/);
  assert.match(source, /suggestedTarget: selectedScenario\.suggestedTarget/);
  assert.match(source, /void runDiscovery\(normalizedUrl, routeState\)/);
  assert.match(source, /isDiscoveryBusy\(discoveryState\.kind\)/);
  assert.match(source, /discoveryRequestSeq\.current \+= 1/);
  assert.doesNotMatch(source, /const explicitProjectId = getProjectId\(currentRouteState\)/);
  assert.doesNotMatch(source, /\.\.\.\(explicitProjectId \? \{ projectId: explicitProjectId \} : \{\}\)/);
  assert.match(source, /const discoveryRouteState = createDiscoveryRouteState\(currentRouteState, targetUrl\)/);
  assert.match(source, /createDiscoveryIdempotencyKey\(targetUrl\)/);
  assert.match(source, /await createDiscovery/);
  assert.match(source, /await getDiscovery\(discoveryId\)/);
  assert.match(source, /createdRunId = response\.data\.id/);
  assert.match(source, /await startRun\(createdRunId\)/);
  assert.match(source, /분석 준비는 완료됐지만 시작 요청에 실패했습니다/);
  assert.match(source, /pushAppPath\(buildRunMonitorPath\(createdRunId/);
  assert.doesNotMatch(source, /window\.location\.assign/);
  assert.match(source, /시나리오 생성/);
  assert.match(source, /마찰 기록/);
  assert.match(source, /리포트 생성/);
  assert.match(source, /onChooseDifferentScenario=\{chooseDifferentScenario\}/);
  assert.match(source, /const chooseDifferentScenario = \(\) => \{[\s\S]*?createRecommendationChoiceRouteState\(routeState, submittedUrl\)/);
  assert.match(source, /onStartRun=\{startAnalysisRun\}/);
  assert.match(source, /className="create-analysis-secondary-action"/);
  assert.match(source, /onClick=\{onChooseDifferentScenario\} disabled=\{isCreatingRun\}/);
  assert.match(source, /다른 흐름 선택/);

  assert.match(css, /\.create-analysis-secondary-action\s*\{[\s\S]*?border: 0/);
  assert.match(css, /\.create-analysis-secondary-action\s*\{[\s\S]*?color: #ffffff/);
  assert.match(css, /\.create-analysis-secondary-action:disabled\s*\{[\s\S]*?cursor: not-allowed/);
});

test('create analysis page wires stages to browser history query state', () => {
  const source = fs.readFileSync(
    new URL('../../src/pages/create-analysis/CreateAnalysisPage.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /parseCreateAnalysisRouteState\(window\.location\.search, CREATE_ANALYSIS_ROUTE_OPTIONS\)/);
  assert.match(source, /readCurrentUser\(\)/);
  assert.match(source, /routeStateWithDevContext = withCreateRunContextFallback\(nextRouteState, getCreateRunContextFallback\(\)\)/);
  assert.match(source, /buildCreateAnalysisPath\(routeStateWithDevContext, CREATE_ANALYSIS_ROUTE_OPTIONS\)/);
  assert.match(source, /setRouteState\(routeStateWithDevContext\)/);
  assert.match(source, /window\.history\.pushState\(null, '', nextPath\)/);
  assert.match(source, /window\.history\.replaceState\(null, '', nextPath\)/);
  assert.match(source, /window\.addEventListener\('popstate', handlePopState\)/);
  assert.match(source, /window\.removeEventListener\('popstate', handlePopState\)/);
  assert.match(source, /stage: 'discovering'/);
  assert.match(source, /stage: 'recommendations'/);
  assert.match(source, /discoveryState/);
  assert.match(source, /stage: 'onboarding'/);
  assert.match(source, /stage: 'ready'/);
  assert.match(source, /createScenarioReadyRouteState\(routeState, submittedUrl, scenario\.id, DEFAULT_SCENARIO_DEPTH_ID\)/);
  assert.match(source, /createRecommendationChoiceRouteState\(routeState, submittedUrl\)/);
});
