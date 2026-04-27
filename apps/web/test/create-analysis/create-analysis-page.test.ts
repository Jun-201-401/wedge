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
  assert.match(source, /Site trace active/);
  assert.match(source, /className="preflight-agent__progress"/);
  assert.match(source, /className="preflight-agent__timeline"/);
  assert.match(source, /preflight-agent__step preflight-agent__step--\$\{step\.status\}/);
  assert.match(source, /className="preflight-agent__rail"/);
  assert.match(source, /className="preflight-agent__node-spinner"/);
  assert.match(source, /className="create-analysis-panel__action preflight-agent__action"/);
  assert.match(source, /onClick=\{onShowRecommendations\}/);
  assert.match(source, /onShowRecommendations=\{showRecommendations\}/);
});

test('create analysis preflight css keeps the landing-agent card language', () => {
  const css = fs.readFileSync(
    new URL('../../src/pages/create-analysis/CreateAnalysisPage.css', import.meta.url),
    'utf8',
  );

  assert.match(css, /\.create-analysis-panel--preflight\s*\{[\s\S]*?background: transparent/);
  assert.match(css, /\.preflight-agent,\s*\n\.recommendation-agent,\s*\n\.scenario-setup-agent,\s*\n\.ready-agent\s*\{[\s\S]*?font-family: 'Pretendard Variable', Pretendard, 'Inter', sans-serif/);
  assert.match(css, /\.preflight-agent,\s*\n\.recommendation-agent,\s*\n\.scenario-setup-agent,\s*\n\.ready-agent\s*\{[\s\S]*?box-shadow: 0 12px 40px -10px/);
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
  assert.match(source, /Scenario match complete/);
  assert.match(source, /className="recommendation-agent__count"/);
  assert.match(source, /onChooseScenario=\{chooseScenario\}/);
  assert.match(source, /onClick=\{\(\) => onChooseScenario\(scenario\)\}/);

  assert.match(css, /\.create-analysis-panel--recommendations\s*\{[\s\S]*?width: min\(100%, 66rem\)/);
  assert.match(css, /\.preflight-agent,\s*\n\.recommendation-agent,\s*\n\.scenario-setup-agent,\s*\n\.ready-agent\s*\{[\s\S]*?font-family: 'Pretendard Variable', Pretendard, 'Inter', sans-serif/);
  assert.match(css, /\.recommendation-agent \.scenario-card button\s*\{[\s\S]*?background: #334155/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.recommendation-agent__header-status-dot::after[\s\S]*?animation: none/);
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
  assert.match(source, /className="create-analysis-panel create-analysis-panel--ready"/);
  assert.match(source, /className="ready-agent"/);
  assert.match(source, /Run 생성 준비 완료/);
  assert.match(source, /selectedDepth=\{selectedDepth\}/);
  assert.match(source, /className="ready-agent__summary-grid"/);
  assert.match(source, /className="ready-agent__launch-plan"/);

  assert.match(css, /\.create-analysis-panel--ready\s*\{[\s\S]*?width: min\(100%, 48rem\)/);
  assert.match(css, /\.ready-agent__summary-grid\s*\{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.ready-agent__launch-plan\s*\{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.ready-agent__header-status-dot::after[\s\S]*?animation: none/);
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
  assert.match(source, /위험 행동 없이 탐색합니다/);
  assert.match(source, /실제 결제, 삭제·변경 같은 위험 행동, OAuth 우회는 수행하지 않습니다\./);
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

  assert.match(source, /import \{ createRun, startRun \} from '..\/..\/api\/runs'/);
  assert.match(source, /import \{ buildMockRunId, buildRunMonitorPath \}/);
  assert.match(source, /getCreateRunIds/);
  assert.match(source, /const createRunIds = useMemo/);
  assert.match(source, /readCreateRunContextFromEnv\(import\.meta\.env\)/);
  assert.match(source, /withCreateRunContextFallback/);
  assert.match(source, /projectId: createRunIds\.projectId/);
  assert.match(source, /scenarioTemplateVersionId: createRunIds\.scenarioTemplateVersionId/);
  assert.match(source, /scenarioPlan: buildPrototypeScenarioPlan/);
  assert.match(source, /schema_version: 'prototype\.v1'/);
  assert.match(source, /start_url: submittedUrl/);
  assert.match(source, /device: 'desktop'/);
  assert.match(source, /step_type: 'CHECKPOINT'/);
  assert.match(source, /createdRunId = response\.data\.id/);
  assert.match(source, /await startRun\(createdRunId\)/);
  assert.match(source, /Run은 생성됐지만 시작 요청에 실패했습니다/);
  assert.match(source, /window\.location\.assign\(buildRunMonitorPath\(createdRunId/);
  assert.match(source, /window\.location\.assign\(fallbackPath\)/);
  assert.match(source, /실시간 Trace 화면에서 진행률/);
  assert.match(source, /onEditScope=\{editScope\}/);
  assert.match(source, /onStartRun=\{startAnalysisRun\}/);
  assert.match(source, /onClick=\{onEditScope\} disabled=\{isCreatingRun\}/);
  assert.match(source, /범위 다시 조정/);

  assert.match(css, /\.ready-agent__secondary-action\s*\{[\s\S]*?border: 1px solid rgba\(226, 232, 240, 0\.9\)/);
  assert.match(css, /\.ready-agent__secondary-action:disabled\s*\{[\s\S]*?cursor: not-allowed/);
});

test('create analysis page wires stages to browser history query state', () => {
  const source = fs.readFileSync(
    new URL('../../src/pages/create-analysis/CreateAnalysisPage.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /parseCreateAnalysisRouteState\(window\.location\.search, CREATE_ANALYSIS_ROUTE_OPTIONS\)/);
  assert.match(source, /routeStateWithDevContext = withCreateRunContextFallback\(nextRouteState, DEV_CREATE_RUN_CONTEXT\)/);
  assert.match(source, /buildCreateAnalysisPath\(routeStateWithDevContext, CREATE_ANALYSIS_ROUTE_OPTIONS\)/);
  assert.match(source, /setRouteState\(routeStateWithDevContext\)/);
  assert.match(source, /window\.history\.pushState\(null, '', nextPath\)/);
  assert.match(source, /window\.history\.replaceState\(null, '', nextPath\)/);
  assert.match(source, /window\.addEventListener\('popstate', handlePopState\)/);
  assert.match(source, /window\.removeEventListener\('popstate', handlePopState\)/);
  assert.match(source, /stage: 'discovering'/);
  assert.match(source, /stage: 'recommendations'/);
  assert.match(source, /stage: 'onboarding'/);
  assert.match(source, /stage: 'ready'/);
});
