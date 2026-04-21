const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(rootDir, 'app.js'), 'utf8');
const styleCss = fs.readFileSync(path.join(rootDir, 'style.css'), 'utf8');
const dashboardData = JSON.parse(fs.readFileSync(path.join(rootDir, 'zro_data.json'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const refreshEntrypoint = fs.readFileSync(path.join(rootDir, 'refresh_dashboard_data.py'), 'utf8');
const sanitizeEntrypoint = fs.readFileSync(path.join(rootDir, 'sanitize_zro_data.py'), 'utf8');
const generateFlowsEntrypoint = fs.readFileSync(path.join(rootDir, 'generate_flows.py'), 'utf8');
const updateDataEntrypoint = fs.readFileSync(path.join(rootDir, 'update_data.py'), 'utf8');
const detectFreshEntrypoint = fs.readFileSync(path.join(rootDir, 'detect_fresh.py'), 'utf8');
const backfillFreshEntrypoint = fs.readFileSync(path.join(rootDir, 'backfill_fresh.py'), 'utf8');
const freshWalletHelpers = fs.readFileSync(path.join(rootDir, 'fresh_wallet_utils.py'), 'utf8');
const cexRegistry = fs.readFileSync(path.join(rootDir, 'cex_addresses.py'), 'utf8');
const autoLabelEntrypoint = fs.readFileSync(path.join(rootDir, 'auto_label.py'), 'utf8');
const cbMonitorEntrypoint = fs.readFileSync(path.join(rootDir, 'monitor_cb_prime.py'), 'utf8');
const whaleMonitorEntrypoint = fs.readFileSync(path.join(rootDir, 'monitor_whale_transfers.py'), 'utf8');

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
  assert.match(appJs, /function compareFreshSignal\(/);
  assert.match(appJs, /function getFreshCreatedDisplay\(/);
  assert.match(appJs, /function getSnapshotStatusMeta\(/);
  assert.match(appJs, /function renderHeaderStatus\(/);
  assert.match(appJs, /function setFreshFilter\(/);
  assert.match(appJs, /function setActiveDataChoice\(/);
  assert.match(appJs, /function getFreshWalletUniverse\(/);
  assert.match(appJs, /data-fresh-filter-target/);
});

test('repo exposes one-command local refresh entrypoints', () => {
  assert.equal(packageJson.scripts['refresh:data'], 'python3 refresh_dashboard_data.py --mode full');
  assert.equal(packageJson.scripts['refresh:data:hourly'], 'python3 refresh_dashboard_data.py --mode hourly');
  assert.equal(packageJson.scripts['refresh:data:plan'], 'python3 refresh_dashboard_data.py --mode full --dry-run');
  assert.match(refreshEntrypoint, /PIPELINES =/);
  assert.match(refreshEntrypoint, /"full":/);
  assert.match(refreshEntrypoint, /"hourly":/);
  assert.match(refreshEntrypoint, /Backfill fresh wallet metadata/);
  assert.match(refreshEntrypoint, /Normalize zro_data\.json/);
  assert.match(refreshEntrypoint, /--dry-run/);
  assert.match(sanitizeEntrypoint, /duplicate_holder_records_removed/);
  assert.match(sanitizeEntrypoint, /chain_balance_anomalies/);
});

test('flow generation keeps chain context and focuses rankings on tracked holders', () => {
  assert.match(generateFlowsEntrypoint, /"chain": chain_name/);
  assert.match(generateFlowsEntrypoint, /FLOW_INFRA_TYPES/);
  assert.match(generateFlowsEntrypoint, /retention_ratio/);
  assert.match(generateFlowsEntrypoint, /primary_flow_chain/);
  assert.match(generateFlowsEntrypoint, /is_meaningful_accumulator/);
  assert.match(generateFlowsEntrypoint, /is_meaningful_seller/);
  assert.match(sanitizeEntrypoint, /def normalize_flows\(/);
  assert.match(sanitizeEntrypoint, /excluded_low_retention/);
  assert.match(appJs, /function hydrateFlowChainFallbacks\(/);
  assert.match(appJs, /function getHolderFlowChainFallbacks\(/);
  assert.match(appJs, /function flowMatchesChain\(/);
  assert.match(appJs, /function isMeaningfulFlowItem\(/);
  assert.match(indexHtml, /Tracked holders only/);
});

test('fresh wallet labels stay sticky across the pipeline', () => {
  assert.match(updateDataEntrypoint, /label_manual/);
  assert.match(updateDataEntrypoint, /fresh/);
  assert.match(detectFreshEntrypoint, /def apply_fresh_wallet_label\(/);
  assert.match(detectFreshEntrypoint, /Fresh Wallet stays sticky/);
  assert.match(detectFreshEntrypoint, /Preserve Fresh/);
  assert.match(whaleMonitorEntrypoint, /"label_manual": True/);
});

test('fresh wallet heuristics use shared multi-chain helpers', () => {
  assert.match(freshWalletHelpers, /SUPPORTED_CHAINS/);
  assert.match(freshWalletHelpers, /PRIMARY_CEX_CHAINS/);
  assert.match(freshWalletHelpers, /def get_first_activity_timestamp_multichain/);
  assert.match(freshWalletHelpers, /def get_latest_zro_transfer_context_multichain/);
  assert.match(freshWalletHelpers, /def analyze_cex_interactions/);
  assert.match(freshWalletHelpers, /def derive_fresh_signal/);
  assert.match(freshWalletHelpers, /def has_cex_interaction_multichain/);
  assert.match(detectFreshEntrypoint, /from fresh_wallet_utils import/);
  assert.match(backfillFreshEntrypoint, /from fresh_wallet_utils import/);
  assert.match(whaleMonitorEntrypoint, /from fresh_wallet_utils import/);
  assert.doesNotMatch(detectFreshEntrypoint, /return None, deployer/);
});

test('CEX registry and anti-CEX heuristics are centralized and refined', () => {
  assert.match(cexRegistry, /KNOWN_CEX_ADDRESSES =/);
  assert.match(cexRegistry, /KNOWN_COINBASE_ADDRESSES =/);
  assert.match(autoLabelEntrypoint, /from cex_addresses import KNOWN_CEX_ADDRESSES/);
  assert.match(updateDataEntrypoint, /from cex_addresses import KNOWN_CEX_ADDRESSES/);
  assert.match(backfillFreshEntrypoint, /from cex_addresses import KNOWN_CEX_ADDRESSES/);
  assert.match(whaleMonitorEntrypoint, /from cex_addresses import KNOWN_CEX_ADDRESSES/);
  assert.match(cbMonitorEntrypoint, /from cex_addresses import KNOWN_CEX_ADDRESSES/);
  assert.match(freshWalletHelpers, /def apply_fresh_profile/);
  assert.match(freshWalletHelpers, /profile = "cex_recycler"/);
  assert.match(freshWalletHelpers, /profile = "active_cex_user"/);
  assert.match(freshWalletHelpers, /profile = "mixed_cex_activity"/);
  assert.match(freshWalletHelpers, /profile = "cex_accumulator"/);
  assert.match(freshWalletHelpers, /profile = "cex_funded"/);
  assert.match(freshWalletHelpers, /outgoing_to_cex_count >= 20/);
  assert.match(freshWalletHelpers, /signal = "fresh_whale_accumulator"/);
  assert.match(freshWalletHelpers, /signal = "fresh_accumulator"/);
  assert.match(freshWalletHelpers, /signal = "accumulator_watchlist"/);
  assert.match(freshWalletHelpers, /signal = "high_turnover"/);
  assert.match(detectFreshEntrypoint, /if cex_filter\["profile"\] == "cex_recycler":/);
  assert.match(updateDataEntrypoint, /fresh_signal_label/);
  assert.match(sanitizeEntrypoint, /fresh_signal_label/);
  assert.match(appJs, /fresh_profile_label/);
  assert.match(appJs, /fresh_signal_label/);
  assert.doesNotMatch(freshWalletHelpers, /return has_deposit or cex_interactions >= 2/);
  assert.doesNotMatch(freshWalletHelpers, /multiple_cex_deposits/);
});

test('page copy clearly distinguishes live price from indexed snapshot data', () => {
  assert.match(indexHtml, /Live ZRO Price \+ Indexed On-Chain Snapshot/);
  assert.match(indexHtml, /id="snapshot-banner"/);
  assert.match(indexHtml, /id="header-status-grid"/);
  assert.match(indexHtml, /id="page-loading"/);
  assert.match(indexHtml, /id="detail-drawer"/);
  assert.match(indexHtml, /id="fresh-sort-signal"/);
  assert.match(indexHtml, /id="fresh-filter-pills"/);
  assert.match(indexHtml, /data-fresh-filter="accumulators"/);
  assert.match(indexHtml, /data-fresh-filter="whales"/);
  assert.doesNotMatch(indexHtml, /id="fresh-card"[\s\S]*% of Supply[\s\S]*id="cb-card"/);
  assert.match(indexHtml, /table-mobile-holders/);
  assert.doesNotMatch(indexHtml, /Real-time LayerZero token flows/i);
  assert.match(styleCss, /header-status-grid/);
  assert.match(styleCss, /font-display/);
});

test('snapshot data remains internally consistent', () => {
  assert.equal(dashboardData.meta.total_supply, dashboardData.total_supply);

  const allocationTotal = Object.values(dashboardData.allocation).reduce((sum, item) => sum + item.pct, 0);
  assert.equal(Number(allocationTotal.toFixed(6)), 100);

  const generatedAt = Date.parse(dashboardData.meta.generated);
  assert.ok(Number.isFinite(generatedAt), 'generated timestamp should be parseable');
  assert.ok(dashboardData.meta.integrity, 'integrity diagnostics should be present on the snapshot');

  assert.ok(Array.isArray(dashboardData.top_holders) && dashboardData.top_holders.length > 100);
  assert.ok(Array.isArray(dashboardData.cb_prime_transfers) && dashboardData.cb_prime_transfers.length > 0);
  assert.ok(Array.isArray(dashboardData.whale_transfers) && dashboardData.whale_transfers.length > 0);

  const uniqueAddresses = new Set(dashboardData.top_holders.map((holder) => holder.address.toLowerCase()));
  assert.ok(uniqueAddresses.size > 100, 'snapshot should keep a meaningful unique holder set');

  const freshWallets = dashboardData.top_holders.filter((holder) => holder.type === 'FRESH' || holder.label === 'Fresh Wallet');
  assert.ok(freshWallets.length > 0, 'snapshot should contain fresh wallets');
  for (const holder of freshWallets) {
    assert.equal(holder.label, 'Fresh Wallet', 'fresh wallets should keep the canonical label');
    assert.equal(holder.type, 'FRESH', 'fresh wallets should keep the canonical type');
    assert.equal(holder.label_manual, true, 'fresh wallets should be sticky in the pipeline');
    if (holder.fresh_profile_label) {
      assert.equal(typeof holder.fresh_profile_label, 'string');
    }
  }

  for (const period of ['1d', '7d', '30d', '90d', '180d', 'all']) {
    assert.ok(dashboardData.flows[period], `missing flow period ${period}`);
    assert.ok(Array.isArray(dashboardData.flows[period].accumulators), `missing accumulators for ${period}`);
    assert.ok(Array.isArray(dashboardData.flows[period].sellers), `missing sellers for ${period}`);
    for (const item of dashboardData.flows[period].accumulators) {
      assert.ok(typeof item.address === 'string' && item.address.startsWith('0x'), `accumulator should expose address in ${period}`);
      assert.ok(Number(item.net_flow || 0) > 0, `accumulator should keep positive net flow in ${period}`);
    }
    for (const item of dashboardData.flows[period].sellers) {
      assert.ok(typeof item.address === 'string' && item.address.startsWith('0x'), `seller should expose address in ${period}`);
      assert.ok(Number(item.net_flow || 0) < 0, `seller should keep negative net flow in ${period}`);
    }
  }
});

test('app.js anchors relative filters and labels to the snapshot timestamp', () => {
  assert.match(appJs, /function getSnapshotReferenceMs\(/);
  assert.match(appJs, /function getSnapshotReferenceSec\(/);
  assert.match(appJs, /formatDaysAgoFromSnapshot/);
  assert.match(appJs, /const nowSec = getSnapshotReferenceSec\(\)/);
});

test('premium mobile tables expose drawer and loading primitives', () => {
  assert.match(appJs, /function setLoadingState\(/);
  assert.match(appJs, /function openDetailDrawer\(/);
  assert.match(appJs, /function closeDetailDrawer\(/);
  assert.match(appJs, /function buildWalletDrawerPayload\(/);
  assert.match(appJs, /data-detail-key/);
  assert.match(appJs, /tableEmptyStateHTML/);
  assert.match(styleCss, /page-loading/);
  assert.match(styleCss, /detail-drawer/);
  assert.match(styleCss, /table-mobile-holders/);
});

test('coinbase transfer toolbar keeps a CSS-driven search width and selectable dropdown', () => {
  assert.match(indexHtml, /class="flow-toolbar cbt-toolbar"/);
  assert.match(indexHtml, /id="cbt-type-dropdown"/);
  assert.match(appJs, /function closeFloatingMenus\(/);
  assert.match(appJs, /document\.addEventListener\('pointerdown', handleDocumentPointerDown\)/);
  assert.match(styleCss, /\.cbt-toolbar \.search-wrap/);
  assert.match(styleCss, /\.cbt-type-menu \{[^}]*z-index:140;/);
});

test('fresh wallets default to signal-ranked sorting for accumulator discovery', () => {
  assert.match(appJs, /let freshPage=1, freshSearchQuery='', freshSortKey='signal', freshSortDir='desc', freshFilterMode='all';/);
  assert.match(appJs, /freshFilterMode = pickAllowedValue\(params\.get\('freshFilter'\), \['all', 'accumulators', 'whales'\], 'all'\)/);
  assert.match(appJs, /freshSortKey = pickAllowedValue\(params\.get\('freshSort'\), \['signal', 'date', 'flow', 'balance'\], 'signal'\)/);
  assert.match(appJs, /if \(freshSortKey === 'signal'\)/);
  assert.match(appJs, /strong accumulator signals/);
  assert.match(appJs, /matchesFreshFilter/);
  assert.match(appJs, /FRESH_FILTER_LABELS/);
  assert.match(appJs, /Whale Accumulators/);
  assert.match(styleCss, /accent-amber/);
  assert.match(appJs, /setFreshFilter\(freshFilterTarget\.dataset\.freshFilterTarget\)/);
  assert.match(styleCss, /fresh-stat-clickable/);
});
