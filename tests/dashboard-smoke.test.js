const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(rootDir, 'app.js'), 'utf8');
const dashboardData = JSON.parse(fs.readFileSync(path.join(rootDir, 'zro_data.json'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const refreshEntrypoint = fs.readFileSync(path.join(rootDir, 'refresh_dashboard_data.py'), 'utf8');

function extractIds(html) {
  const ids = [];
  const pattern = /\bid="([^"]+)"/g;
  for (const match of html.matchAll(pattern)) ids.push(match[1]);
  return ids;
}

test('dashboard markup and scripts do not rely on inline event handlers', () => {
  const inlineHandlerPattern = /\son(?:click|input|change|keydown|error)=/i;
  assert.doesNotMatch(indexHtml, inlineHandlerPattern);
  assert.doesNotMatch(appJs, inlineHandlerPattern);
});

test('index.html keeps IDs unique', () => {
  const ids = extractIds(indexHtml);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(duplicates, []);
});

test('app.js includes URL state helpers and delegated interaction plumbing', () => {
  assert.match(appJs, /activeTab\s*=\s*'overview'/);
  assert.match(appJs, /stateSyncReady\s*=\s*false/);
  assert.match(appJs, /requestHistoryMode/);
  assert.match(appJs, /function applyStateFromUrl\(/);
  assert.match(appJs, /function updateUrlState\(/);
  assert.match(appJs, /function syncControlsFromState\(/);
  assert.match(appJs, /function initEventDelegation\(/);
  assert.match(appJs, /window\.addEventListener\('popstate', handlePopState\)/);
  assert.match(appJs, /data-page-target/);
});

test('repo exposes one-command local refresh entrypoints', () => {
  assert.equal(packageJson.scripts['refresh:data'], 'python3 refresh_dashboard_data.py --mode full');
  assert.equal(packageJson.scripts['refresh:data:hourly'], 'python3 refresh_dashboard_data.py --mode hourly');
  assert.equal(packageJson.scripts['refresh:data:plan'], 'python3 refresh_dashboard_data.py --mode full --dry-run');
  assert.match(refreshEntrypoint, /PIPELINES =/);
  assert.match(refreshEntrypoint, /"full":/);
  assert.match(refreshEntrypoint, /"hourly":/);
  assert.match(refreshEntrypoint, /--dry-run/);
});

test('page copy clearly distinguishes live price from indexed snapshot data', () => {
  assert.match(indexHtml, /Live ZRO Price \+ Indexed On-Chain Snapshot/);
  assert.match(indexHtml, /id="snapshot-banner"/);
  assert.doesNotMatch(indexHtml, /Real-time LayerZero token flows/i);
});

test('snapshot data remains internally consistent', () => {
  assert.equal(dashboardData.meta.total_supply, dashboardData.total_supply);

  const allocationTotal = Object.values(dashboardData.allocation).reduce((sum, item) => sum + item.pct, 0);
  assert.equal(Number(allocationTotal.toFixed(6)), 100);

  const generatedAt = Date.parse(dashboardData.meta.generated);
  assert.ok(Number.isFinite(generatedAt), 'generated timestamp should be parseable');

  assert.ok(Array.isArray(dashboardData.top_holders) && dashboardData.top_holders.length > 100);
  assert.ok(Array.isArray(dashboardData.cb_prime_transfers) && dashboardData.cb_prime_transfers.length > 0);
  assert.ok(Array.isArray(dashboardData.whale_transfers) && dashboardData.whale_transfers.length > 0);

  for (const period of ['1d', '7d', '30d', '90d', '180d', 'all']) {
    assert.ok(dashboardData.flows[period], `missing flow period ${period}`);
    assert.ok(Array.isArray(dashboardData.flows[period].accumulators), `missing accumulators for ${period}`);
    assert.ok(Array.isArray(dashboardData.flows[period].sellers), `missing sellers for ${period}`);
  }
});
