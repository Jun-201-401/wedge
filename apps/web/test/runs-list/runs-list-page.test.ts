import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('runs list page connects the implemented listRuns API to monitor/report navigation', () => {
  const page = fs.readFileSync(new URL('../../src/pages/runs-list/RunsListPage.tsx', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../../src/app/App.tsx', import.meta.url), 'utf8');
  const routes = fs.readFileSync(new URL('../../src/app/appRoute.ts', import.meta.url), 'utf8');
  const pages = fs.readFileSync(new URL('../../src/pages/index.ts', import.meta.url), 'utf8');

  assert.match(routes, /pathname === RUNS_PATH/);
  assert.match(app, /route\.kind === 'runs-list'/);
  assert.match(app, /<RunsListPage currentUser=\{currentUser\} onLogout=\{handleLogout\} \/>/);
  assert.match(pages, /runsList/);
  assert.match(page, /import \{ listRuns \}/);
  assert.match(page, /await listRuns\(\)/);
  assert.match(page, /실행 목록/);
  assert.match(page, /저장된 실행/);
  assert.match(page, /실시간 보기/);
  assert.match(page, /리포트/);
  assert.match(page, /buildRunReportPath/);
  assert.match(page, /RUN_STATUS_LABEL/);
  assert.match(page, /getSafeHttpUrl/);
  assert.match(page, /formatRunUrlLabel/);
  assert.match(page, /title=\{run\.startUrl\}/);
  assert.match(page, /aria-pressed=\{statusFilter === filter\.value\}/);
  assert.match(page, /로그아웃/);
});

test('runs list css keeps the run dashboard in the light cockpit visual system', () => {
  const css = fs.readFileSync(new URL('../../src/pages/runs-list/RunsListPage.css', import.meta.url), 'utf8');

  assert.match(css, /\.runs-list-page\s*\{[\s\S]*?background: #fff/);
  assert.match(css, /\.runs-list-topbar\s*\{[\s\S]*?height: 4rem/);
  assert.match(css, /\.runs-list-card\s*\{[\s\S]*?box-shadow: 0 28px 80px/);
  assert.match(css, /\.runs-list-row\s*\{[\s\S]*?grid-template-columns:/);
  assert.match(css, /\.runs-list-url\s*\{[\s\S]*?text-decoration: none/);
  assert.match(css, /\.runs-list-status--complete/);
  assert.match(css, /\.runs-list-status--active/);
  assert.match(css, /@media \(max-width: 920px\)/);
});
