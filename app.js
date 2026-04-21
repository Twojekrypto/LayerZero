/* ZRO Analytics Dashboard — app.js */
let DATA = null, currentPeriod = '30d', holdersPage = 1, toastTimer = null, activeTab = 'overview', stateSyncReady = false, nextHistoryMode = 'replace';
let compactTableMode = null, resizeTimer = null, activeDrawerKey = null;
const detailRegistry = new Map();
const HOLDERS_PER_PAGE = 25, FLOW_PER_PAGE = 10;
let holdersSortKey = 'total', holdersSortDir = 'desc', holdersSearchQuery = '', holdersHideEntities = false;
const HIDDEN_HOLDER_ENTITY_TYPES = new Set(['CEX', 'DEX', 'PROTOCOL', 'INST', 'VC', 'TEAM', 'CUSTODY', 'MULTISIG', 'MM', 'UNLOCK']);
const FRESH_FILTER_LABELS = {
    all: 'fresh wallets',
    accumulators: 'accumulators',
    whales: 'whale accumulators',
};
const FLOW_INFRA_TYPES = new Set(['CEX', 'DEX', 'PROTOCOL', 'TEAM', 'MULTISIG', 'CUSTODY', 'MM', 'UNLOCK']);
const FLOW_MIN_RETENTION = 0.25;
const FLOW_MIN_BALANCE = 1000;
const FLOW_MIN_NET_RETENTION = 0.10;
const FLOW_MIN_BALANCE_SHARE = 0.01;
const FLOW_MIN_SELL_BALANCE_SHARE = 0.005;
const FLOW_COHORT_LABELS = {
    all: 'All holders',
    organic: 'Organic',
    strategic: 'Strategic / VC',
    coinbase: 'Coinbase / Custody',
};
const ACCUMULATION_SOURCE_LABELS = {
    coinbase_funded: 'Coinbase funded',
    cex_funded: 'CEX funded',
    strategic_inflow: 'Strategic inflow',
    holder_built: 'Holder-built',
    external_inflow: 'External inflow',
    mixed_inflow: 'Mixed inflow',
    unresolved_inflow: 'Unresolved inflow',
};
const SELLER_PROFILE_LABELS = {
    coinbase_outflow: 'Coinbase outflow',
    cex_outflow: 'CEX outflow',
    strategic_rotation: 'Strategic rotation',
    holder_redistribution: 'Holder redistribution',
    external_outflow: 'External outflow',
    mixed_outflow: 'Mixed outflow',
    coinbase_rotation: 'Coinbase rotation',
    unresolved_outflow: 'Unresolved outflow',
};
const FRESH_FLOW_LABELS = {
    fresh_whale_accumulator: 'Fresh whale',
    fresh_accumulator: 'Fresh accumulator',
    fresh_wallet: 'Fresh wallet',
    fresh_seller: 'Fresh seller',
};
const WHALE_FILTER_LABELS = {
    ALL: 'Large transfers',
    BUY: 'Buy-side transfers',
    SELL: 'Sell-side transfers',
    MOVE: 'Wallet-to-wallet moves',
};
const STRATEGIC_FLOW_TYPES = new Set(['VC', 'TEAM', 'UNLOCK', 'INST']);

function fmt(n, d=0) {
    if (n==null||isNaN(n)) return '—';
    if (Math.abs(n)>=1e9) return (n/1e9).toFixed(2)+'B';
    if (Math.abs(n)>=1e6) return (n/1e6).toFixed(2)+'M';
    if (Math.abs(n)>=1e3) return (n/1e3).toFixed(1)+'K';
    return n.toLocaleString('en-US',{maximumFractionDigits:d});
}
function fmtUSD(n) {
    if (n==null||isNaN(n)) return '—';
    if (Math.abs(n)>=1e9) return '$'+(n/1e9).toFixed(2)+'B';
    if (Math.abs(n)>=1e6) return '$'+(n/1e6).toFixed(2)+'M';
    if (Math.abs(n)>=1e3) return '$'+(n/1e3).toFixed(1)+'K';
    return '$'+n.toFixed(2);
}
function shortAddr(a) { return (!a||a.length<12)?a||'':a.slice(0,6)+'…'+a.slice(-4); }
function setText(id, value) { const el = document.getElementById(id); if (el) el.textContent = value; }
function setInputValue(id, value) { const el = document.getElementById(id); if (el) el.value = value; }
function setCheckboxValue(id, checked) { const el = document.getElementById(id); if (el) el.checked = checked; }
function escapeAttr(value) { return String(value).replace(/"/g, '&quot;'); }
function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function dataLabelAttr(label) { return ` data-label="${escapeAttr(label)}"`; }
function tableEmptyStateHTML(icon, title, detail='') {
    return `<div class="table-empty-state"><div class="empty-icon">${icon}</div><div class="empty-text">${escapeHtml(title)}</div>${detail ? `<div class="empty-detail">${escapeHtml(detail)}</div>` : ''}</div>`;
}
function isCompactTableMode() {
    return window.matchMedia('(max-width: 820px)').matches;
}
function setLoadingState(visible, title='Loading indexed snapshot', detail='Preparing premium dashboard surfaces and holder tables…') {
    const loadingEl = document.getElementById('page-loading');
    if (!loadingEl) return;
    setText('page-loading-title', title);
    setText('page-loading-detail', detail);
    loadingEl.classList.toggle('is-visible', visible);
    loadingEl.setAttribute('aria-hidden', String(!visible));
}
function registerDetailPayload(key, payload) {
    detailRegistry.set(key, payload);
    return ` data-detail-key="${escapeAttr(key)}"`;
}
function detailBadgeHTML(badge) {
    const tone = badge?.tone ? ` tone-${escapeAttr(badge.tone)}` : '';
    return `<span class="detail-chip${tone}">${escapeHtml(badge.label)}</span>`;
}
function detailMetricHTML(metric) {
    return `<div class="detail-metric">
        <div class="detail-metric-value">${escapeHtml(metric.value)}</div>
        <div class="detail-metric-label">${escapeHtml(metric.label)}</div>
        ${metric.sub ? `<div class="detail-metric-sub">${escapeHtml(metric.sub)}</div>` : ''}
    </div>`;
}
function detailListItemHTML(item) {
    return `<div class="detail-list-item">
        <div class="detail-list-label">${escapeHtml(item.label)}</div>
        <div class="detail-list-value">${escapeHtml(item.value)}</div>
        ${item.sub ? `<div class="detail-list-sub">${escapeHtml(item.sub)}</div>` : ''}
    </div>`;
}
function detailActionHTML(action) {
    const primaryClass = action.primary ? ' is-primary' : '';
    return `<a href="${escapeAttr(action.url)}" target="_blank" rel="noopener noreferrer" class="detail-action${primaryClass}">${escapeHtml(action.label)}</a>`;
}
function openDetailDrawer(key) {
    const payload = detailRegistry.get(key);
    const drawer = document.getElementById('detail-drawer');
    const backdrop = document.getElementById('detail-drawer-backdrop');
    if (!payload || !drawer || !backdrop) return;
    activeDrawerKey = key;
    setText('detail-drawer-eyebrow', payload.eyebrow || '');
    setText('detail-drawer-title', payload.title || 'Wallet details');
    setText('detail-drawer-subtitle', payload.subtitle || '');
    document.getElementById('detail-drawer-badges').innerHTML = (payload.badges || []).map(detailBadgeHTML).join('');
    document.getElementById('detail-drawer-metrics').innerHTML = (payload.metrics || []).map(detailMetricHTML).join('');
    const section = document.getElementById('detail-drawer-section');
    const list = payload.list || [];
    if (section) section.hidden = !list.length;
    setText('detail-drawer-section-title', payload.sectionTitle || 'Details');
    document.getElementById('detail-drawer-list').innerHTML = list.map(detailListItemHTML).join('');
    document.getElementById('detail-drawer-actions').innerHTML = (payload.actions || []).map(detailActionHTML).join('');
    backdrop.hidden = false;
    drawer.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('drawer-open');
    document.getElementById('detail-drawer-close')?.focus();
}
function closeDetailDrawer() {
    const drawer = document.getElementById('detail-drawer');
    const backdrop = document.getElementById('detail-drawer-backdrop');
    if (!drawer || !backdrop) return;
    activeDrawerKey = null;
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    backdrop.hidden = true;
    document.body.classList.remove('drawer-open');
}
function fallbackCopyText(t) {
    const ta = document.createElement('textarea');
    ta.value = t;
    ta.setAttribute('readonly', '');
    ta.style.position = 'absolute';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); showToast('Copied: ' + shortAddr(t)); }
    catch (e) { showToast('Copy failed'); }
    finally { document.body.removeChild(ta); }
}
function copyText(t) {
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(t).then(() => showToast('Copied: ' + shortAddr(t))).catch(() => fallbackCopyText(t));
        return;
    }
    fallbackCopyText(t);
}
function showToast(m) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = m;
    t.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2000);
}
function navigateToExternal(url) { window.open(url, '_blank', 'noopener,noreferrer'); }
function copyButtonHTML(value, label='Copy address') {
    const copySvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
    return `<button type="button" class="h-copy-btn" data-copy="${escapeAttr(value)}" aria-label="${escapeAttr(label)}" title="${escapeAttr(label)}">${copySvg}</button>`;
}
function debankIconHTML(url) {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="h-debank-icon" title="Open in DeBank" aria-label="Open in DeBank"><img src="https://debank.com/favicon.ico" width="14" height="14" alt="" aria-hidden="true" class="h-debank-favicon"></a>`;
}
function explorerIconHTML(url, label='View on explorer') {
    const explorerSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="h-explorer-icon" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}">${explorerSvg}</a>`;
}
function clickableRowAttrs(url, label='Open external details') {
    return `role="link" tabindex="0" data-nav-url="${escapeAttr(url)}" aria-label="${escapeAttr(label)}"`;
}
function sortLabel(baseLabel, activeKey, key, dir) {
    if (activeKey !== key) return baseLabel;
    return `${baseLabel} ${dir === 'desc' ? '▼' : '▲'}`;
}
function pageButtonHTML(target, delta, label, disabled=false) {
    return `<button type="button" class="pg-btn" data-page-target="${escapeAttr(target)}" data-page-delta="${delta}" ${disabled ? 'disabled' : ''}>${label}</button>`;
}
function applyPageDelta(currentPage, totalPages, delta) {
    if (delta === -999) return 1;
    if (delta === 999) return totalPages;
    return Math.max(1, Math.min(totalPages, currentPage + delta));
}
function pickAllowedValue(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
}
function parsePositiveInt(value, fallback=1) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function parseBooleanParam(value) { return value === '1' || value === 'true'; }
function getHolderTotalBalance(holder) {
    return Object.values(holder?.balances || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
}
function getHolderSupplyPct(holder) {
    const totalSupply = DATA?.total_supply || DATA?.meta?.total_supply || 1000000000;
    const balance = getHolderTotalBalance(holder);
    return totalSupply > 0 ? (balance / totalSupply) * 100 : 0;
}
function getPositiveChainBalances(holder) {
    return Object.entries(holder?.balances || {})
        .map(([chain, value]) => [chain, Number(value) || 0])
        .filter(([, value]) => value > 0)
        .sort((a, b) => b[1] - a[1]);
}
function getSnapshotReferenceMs() {
    const generatedAt = DATA?.meta?.generated ? Date.parse(DATA.meta.generated) : NaN;
    return Number.isFinite(generatedAt) ? generatedAt : Date.now();
}
function getSnapshotReferenceSec() {
    return Math.floor(getSnapshotReferenceMs() / 1000);
}
function getSnapshotStatusMeta() {
    if (!DATA?.meta?.generated) return null;
    const generatedAt = new Date(DATA.meta.generated);
    const generatedMs = generatedAt.getTime();
    if (!Number.isFinite(generatedMs)) return null;
    const diff = Math.max(0, Math.floor((Date.now() - generatedMs) / 1000));
    let ageLabel;
    if (diff < 60) ageLabel = 'just now';
    else if (diff < 3600) ageLabel = `${Math.floor(diff / 60)} min ago`;
    else if (diff < 86400) ageLabel = `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}min ago`;
    else ageLabel = `${Math.floor(diff / 86400)}d ago`;
    const status = diff < 7200 ? 'fresh' : diff < 86400 ? 'delayed' : 'historical';
    return {
        generatedAt,
        diff,
        ageLabel,
        status,
        chipLabel: status === 'fresh' ? 'Fresh Snapshot' : status === 'delayed' ? 'Delayed Snapshot' : 'Historical Snapshot',
        statusColor: status === 'fresh' ? 'var(--accent-green)' : status === 'delayed' ? 'var(--accent-amber)' : 'var(--accent-orange)',
        statusIcon: status === 'fresh' ? '🟢' : status === 'delayed' ? '🟡' : '🟠',
        absoluteLabel: generatedAt.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }),
    };
}
function formatDaysAgoFromSnapshot(timestamp, todayLabel='today') {
    if (!timestamp) return '';
    const diffDays = Math.max(0, Math.floor((getSnapshotReferenceSec() - timestamp) / 86400));
    return diffDays === 0 ? todayLabel : `${diffDays}d ago`;
}
function compareSnapshotValues(aValue, bValue, dir='desc') {
    const aMissing = !aValue;
    const bMissing = !bValue;
    if (aMissing && bMissing) return 0;
    if (aMissing) return 1;
    if (bMissing) return -1;
    return dir === 'asc' ? aValue - bValue : bValue - aValue;
}
function compareFreshSignal(a, b, dir='desc') {
    const aScore = Number(a?.fresh_signal_score || 0);
    const bScore = Number(b?.fresh_signal_score || 0);
    if (aScore !== bScore) return dir === 'asc' ? aScore - bScore : bScore - aScore;
    const aNet = Number(a?.fresh_net_accumulation || 0);
    const bNet = Number(b?.fresh_net_accumulation || 0);
    if (aNet !== bNet) return dir === 'asc' ? aNet - bNet : bNet - aNet;
    const aRetention = Number(a?.fresh_retention_ratio || 0);
    const bRetention = Number(b?.fresh_retention_ratio || 0);
    if (aRetention !== bRetention) return dir === 'asc' ? aRetention - bRetention : bRetention - aRetention;
    const aBal = getHolderTotalBalance(a);
    const bBal = getHolderTotalBalance(b);
    return dir === 'asc' ? aBal - bBal : bBal - aBal;
}
function getFreshCreatedDisplay(holder) {
    const snapshotRefSec = getSnapshotReferenceSec();
    if (holder?.wallet_created) {
        return {
            value: holder.wallet_created,
            label: new Date(holder.wallet_created * 1000).toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'}),
            sublabel: formatDaysAgoFromSnapshot(holder.wallet_created),
            estimated: false,
        };
    }
    if (holder?.last_flow) {
        return {
            value: holder.last_flow,
            label: `First seen ${new Date(holder.last_flow * 1000).toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'})}`,
            sublabel: `${formatDaysAgoFromSnapshot(holder.last_flow)} · estimated`,
            estimated: true,
        };
    }
    return {
        value: snapshotRefSec,
        label: `Tracked ${new Date(snapshotRefSec * 1000).toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'})}`,
        sublabel: 'Snapshot fallback',
        estimated: true,
    };
}
function getFreshSignalDisplay(holder) {
    const label = holder?.fresh_signal_label || 'Fresh wallet';
    const retention = Number(holder?.fresh_retention_ratio || 0);
    const netAccumulation = Number(holder?.fresh_net_accumulation || 0);
    const signalScore = Number(holder?.fresh_signal_score || 0);

    if (signalScore <= 40 && netAccumulation <= 0 && retention <= 0) {
        return {
            label,
            detail: 'Age-qualified fresh wallet',
            emphasis: 'neutral',
        };
    }

    const parts = [];
    if (netAccumulation > 0) parts.push(`Net +${fmt(netAccumulation)}`);
    if (retention > 0) parts.push(`Ret ${Math.round(retention * 100)}%`);
    if (!parts.length && signalScore > 0) parts.push(`Score ${signalScore}`);
    return {
        label,
        detail: parts.join(' · '),
        emphasis: signalScore >= 80 ? 'strong' : 'normal',
    };
}
function buildWalletDrawerPayload(holder, options={}) {
    const balance = getHolderTotalBalance(holder);
    const price = DATA?.meta?.price_usd || 0;
    const usdValue = price ? fmtUSD(balance * price) : 'Live price unavailable';
    const mainChain = getMainChain(holder.address);
    const chainBalances = getPositiveChainBalances(holder);
    const supplyPct = getHolderSupplyPct(holder).toFixed(4) + '%';
    const title = options.title || holder.label || 'Wallet';
    const subtitle = options.subtitle || holder.address;
    const defaultBadges = [];
    if (holder.type) defaultBadges.push({ label: holder.type, tone: String(holder.type).toLowerCase() });
    if (holder.fresh_signal_label && holder.fresh_signal_label !== 'Fresh wallet') defaultBadges.push({ label: holder.fresh_signal_label, tone: 'accent' });
    if (holder.fresh_profile_label && holder.fresh_profile_label !== 'Independent') defaultBadges.push({ label: holder.fresh_profile_label, tone: 'neutral' });
    if (holder.funded_by) defaultBadges.push({ label: `via ${holder.funded_by}`, tone: 'funded' });
    return {
        eyebrow: options.eyebrow || 'Wallet detail',
        title,
        subtitle,
        badges: options.badges || defaultBadges,
        metrics: options.metrics || [
            { value: `${fmt(balance)} ZRO`, label: 'Balance', sub: usdValue },
            { value: supplyPct, label: 'Supply share', sub: `${chainBalances.length} active chains` },
        ],
        sectionTitle: options.sectionTitle || 'Chain breakdown',
        list: options.list || (chainBalances.length
            ? chainBalances.map(([chain, value]) => ({
                label: DATA?.chains?.[chain]?.name || chain,
                value: `${fmt(value)} ZRO`,
                sub: price ? fmtUSD(value * price) : '',
            }))
            : [{ label: 'No indexed balances', value: 'This wallet has no chain allocation in the current snapshot.' }]),
        actions: options.actions || [
            { label: 'Open in DeBank', url: `https://debank.com/profile/${holder.address}`, primary: true },
            { label: 'Open on explorer', url: `${EXPLORER_MAP[mainChain] || EXPLORER_MAP.ethereum}${holder.address}` },
        ],
    };
}
function getHolderRecordScore(holder) {
    let score = 0;
    if (holder.label_manual) score += 100;
    if (holder.label) score += 20;
    if (holder.type) score += 10;
    score += Object.values(holder).filter(value => value !== '' && value !== null && value !== undefined && value !== false).length;
    score += getHolderTotalBalance(holder) / 1e9;
    return score;
}
function chooseLatestHolderFlow(records, fieldName) {
    const ranked = records
        .filter(record => record?.[fieldName])
        .sort((a, b) => (b[fieldName] || 0) - (a[fieldName] || 0));
    if (!ranked.length) return [null, null];
    const latest = ranked[0];
    const amountField = fieldName === 'last_flow' ? 'last_flow_amount' : 'cb_last_flow_amount';
    return [latest[fieldName], latest[amountField]];
}
function mergeDuplicateHolders(records) {
    const ranked = records.slice().sort((a, b) => getHolderRecordScore(b) - getHolderRecordScore(a));
    const merged = { ...ranked[0], address: ranked[0].address.toLowerCase(), balances: {} };
    const chainKeys = new Set(ranked.flatMap(record => Object.keys(record.balances || {})));
    chainKeys.forEach(chain => {
        merged.balances[chain] = Math.max(...ranked.map(record => Number(record.balances?.[chain] || 0)));
    });

    const bestSignalRecord = ranked
        .filter(record => record.fresh_signal || record.fresh_signal_label)
        .sort((a, b) => Number(b.fresh_signal_score || 0) - Number(a.fresh_signal_score || 0))[0];
    if (bestSignalRecord) {
        if (bestSignalRecord.fresh_signal) merged.fresh_signal = bestSignalRecord.fresh_signal;
        if (bestSignalRecord.fresh_signal_label) merged.fresh_signal_label = bestSignalRecord.fresh_signal_label;
    }

    ['label', 'type', 'funded_by', 'fresh_profile', 'fresh_profile_label', 'fresh_profile_reason'].forEach(key => {
        if (merged[key]) return;
        const candidate = ranked.find(record => record[key]);
        if (candidate) merged[key] = candidate[key];
    });

    [
        'fresh_signal_score',
        'fresh_retention_ratio',
        'fresh_net_accumulation',
        'fresh_total_in_value',
        'fresh_total_out_value',
        'fresh_total_in_count',
        'fresh_total_out_count',
        'fresh_outbound_counterparties',
        'fresh_outbound_ratio',
        'fresh_cex_outbound_ratio',
        'fresh_cex_score',
        'fresh_cex_in_count',
        'fresh_cex_out_count',
        'fresh_cex_touch_count',
        'fresh_cex_in_value',
        'fresh_cex_out_value',
    ].forEach(key => {
        const values = ranked.map(record => record[key]).filter(value => value !== undefined && value !== null && value !== '');
        if (values.length) merged[key] = Math.max(...values);
    });

    if (ranked.some(record => record.label_manual)) merged.label_manual = true;

    const walletCreatedValues = ranked.map(record => record.wallet_created).filter(Boolean);
    if (walletCreatedValues.length) merged.wallet_created = Math.min(...walletCreatedValues);

    const [lastFlow, lastFlowAmount] = chooseLatestHolderFlow(ranked, 'last_flow');
    if (lastFlow) {
        merged.last_flow = lastFlow;
        if (lastFlowAmount !== undefined) merged.last_flow_amount = lastFlowAmount;
    }

    const cbFirstValues = ranked.map(record => record.cb_first_funded).filter(Boolean);
    if (cbFirstValues.length) merged.cb_first_funded = Math.min(...cbFirstValues);

    const [cbLastFunded, cbLastFlowAmount] = chooseLatestHolderFlow(ranked, 'cb_last_funded');
    if (cbLastFunded) {
        merged.cb_last_funded = cbLastFunded;
        if (cbLastFlowAmount !== undefined) merged.cb_last_flow_amount = cbLastFlowAmount;
    }

    const cbTotals = ranked.map(record => record.cb_total_received).filter(value => value !== undefined && value !== null && value !== '');
    if (cbTotals.length) merged.cb_total_received = Math.max(...cbTotals);

    return merged;
}
function computeDataIntegrity(data, duplicateHolderRecordsRemoved=0) {
    const chainTotals = Object.fromEntries(Object.keys(data.chains || {}).map(chain => [chain, 0]));
    const holderIndex = Object.fromEntries((data.top_holders || []).map(holder => [holder.address.toLowerCase(), holder]));
    (data.top_holders || []).forEach(holder => {
        Object.entries(holder.balances || {}).forEach(([chain, value]) => {
            if (chainTotals[chain] != null) chainTotals[chain] += Number(value) || 0;
        });
    });
    const freshWallets = (data.top_holders || []).filter(holder => holder.type === 'FRESH' || holder.fresh === true);
    const chainBalanceAnomalies = Object.entries(data.chains || {}).flatMap(([chain, config]) => {
        const configuredSupply = Number(config.supply || 0);
        const trackedBalance = chainTotals[chain] || 0;
        if (!configuredSupply || trackedBalance <= configuredSupply * 1.005) return [];
        return [{
            chain,
            configured_supply: Number(configuredSupply.toFixed(8)),
            tracked_balance: Number(trackedBalance.toFixed(8)),
            overage: Number((trackedBalance - configuredSupply).toFixed(8)),
        }];
    });
    const flowDiagnostics = Object.fromEntries(Object.entries(data.flows || {}).map(([period, flows]) => {
        const items = [...(flows.accumulators || []), ...(flows.sellers || [])];
        return [period, {
            total_rows: items.length,
            infrastructure_rows: items.filter(item => FLOW_INFRA_TYPES.has(item.type)).length,
            untracked_rows: items.filter(item => !holderIndex[item.address?.toLowerCase?.()]).length,
            zero_balance_rows: items.filter(item => !(Number(item.balance) || 0)).length,
            chain_unresolved_rows: items.filter(item => item?.chain_unresolved).length,
        }];
    }));
    return {
        normalized_at: new Date().toISOString(),
        duplicate_holder_records_removed: duplicateHolderRecordsRemoved,
        fresh_wallets_missing_created: freshWallets.filter(holder => !holder.wallet_created).length,
        fresh_wallets_missing_last_flow: freshWallets.filter(holder => !holder.last_flow).length,
        tracked_chain_balances: Object.fromEntries(
        Object.entries(chainTotals).map(([chain, total]) => [chain, Number(total.toFixed(8))])
        ),
        chain_balance_anomalies: chainBalanceAnomalies,
        flow_diagnostics: flowDiagnostics,
    };
}
function getHolderFlowChainFallbacks(holder) {
    if (!holder?.balances) return [];
    return Object.entries(holder.balances)
        .filter(([, value]) => Number(value || 0) > 0)
        .sort(([, a], [, b]) => Number(b || 0) - Number(a || 0))
        .map(([chain]) => chain);
}
function hydrateFlowChainFallbacks(data) {
    Object.values(data.flows || {}).forEach(periodFlows => {
        ['accumulators', 'sellers'].forEach(side => {
            (periodFlows?.[side] || []).forEach(item => {
                if (Array.isArray(item?.flow_chains) && item.flow_chains.length) {
                    if (!item.primary_flow_chain) item.primary_flow_chain = item.flow_chains[0];
                    delete item.chain_unresolved;
                    return;
                }
                if (item?.chain) {
                    item.flow_chains = [item.chain];
                    item.primary_flow_chain = item.chain;
                    delete item.chain_unresolved;
                    return;
                }
                const holder = data.holder_index?.[item?.address?.toLowerCase?.()];
                const fallbackChains = getHolderFlowChainFallbacks(holder);
                item.chain_unresolved = true;
                if (!fallbackChains.length) return;
                item.flow_chain_guesses = fallbackChains;
                item.primary_flow_guess = fallbackChains[0];
            });
        });
    });
}
function normalizeLoadedData(rawData) {
    const data = rawData || {};
    data.top_holders = data.top_holders || [];
    const grouped = new Map();
    data.top_holders.forEach(holder => {
        const address = holder?.address?.toLowerCase();
        if (!address) return;
        const bucket = grouped.get(address) || [];
        bucket.push({ ...holder, address });
        grouped.set(address, bucket);
    });
    const duplicateHolderRecordsRemoved = data.top_holders.length - grouped.size;
    data.top_holders = Array.from(grouped.values())
        .map(records => mergeDuplicateHolders(records))
        .sort((a, b) => getHolderTotalBalance(b) - getHolderTotalBalance(a));
    data.holder_index = Object.fromEntries(data.top_holders.map(holder => [holder.address.toLowerCase(), holder]));
    hydrateFlowChainFallbacks(data);
    data.meta = data.meta || {};
    data.meta.integrity = computeDataIntegrity(data, duplicateHolderRecordsRemoved);
    return data;
}
function setActivePill(containerId, value) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('button').forEach(btn => btn.classList.toggle('active', btn.dataset.period === String(value)));
}
function setActiveDataChoice(containerId, dataKey, value) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('button').forEach(btn => btn.classList.toggle('active', btn.dataset[dataKey] === String(value)));
}
function requestHistoryMode(mode='replace') {
    if (mode === 'push') nextHistoryMode = 'push';
    else if (nextHistoryMode !== 'push') nextHistoryMode = 'replace';
}

function badgeHTML(type) {
    const m={'CEX':'badge-cex','DEX':'badge-dex','PROTOCOL':'badge-protocol','VC':'badge-vc','INST':'badge-inst','WALLET':'badge-wallet'};
    return `<span class="addr-badge ${m[type]||'badge-wallet'}">${type}</span>`;
}

const EXPLORER_MAP = {
    ethereum: 'https://etherscan.io/address/',
    arbitrum: 'https://arbiscan.io/address/',
    base: 'https://basescan.org/address/',
    bsc: 'https://bscscan.com/address/',
    optimism: 'https://optimistic.etherscan.io/address/',
    polygon: 'https://polygonscan.com/address/',
    avalanche: 'https://snowtrace.io/address/',
};

function getMainChain(addr) {
    // If a chain filter is active, use that chain's explorer
    if (typeof flowChain !== 'undefined' && flowChain !== 'all') return flowChain;
    // Otherwise find which chain has the highest balance
    const holder = DATA.top_holders.find(h => h.address.toLowerCase() === addr.toLowerCase());
    if (!holder || !holder.balances) return 'ethereum';
    let maxChain = 'ethereum', maxBal = 0;
    for (const [chain, bal] of Object.entries(holder.balances)) {
        if (bal > maxBal) { maxBal = bal; maxChain = chain; }
    }
    return maxChain;
}

function getTrackedHolder(address) {
    return DATA?.holder_index?.[address.toLowerCase()] || null;
}

function getFlowItemBalance(item, holder=getTrackedHolder(item.address)) {
    const explicitBalance = Number(item?.balance || 0);
    if (explicitBalance > 0) return explicitBalance;
    return holder ? getHolderTotalBalance(holder) : 0;
}

function getFlowRetentionRatio(item, balance=getFlowItemBalance(item)) {
    const explicitRatio = Number(item?.retention_ratio);
    if (Number.isFinite(explicitRatio) && explicitRatio > 0) return explicitRatio;
    const totalIn = Number(item?.total_in || 0);
    if (totalIn > 0 && balance > 0) return balance / totalIn;
    const netFlow = Number(item?.net_flow || 0);
    return netFlow > 0 && balance > 0 ? balance / netFlow : 0;
}

function getFlowNetRetentionRatio(item) {
    const totalIn = Number(item?.total_in || 0);
    if (totalIn <= 0) return 0;
    return Number(item?.net_flow || 0) / totalIn;
}

function getFlowBalanceShare(item, balance=getFlowItemBalance(item)) {
    if (balance <= 0) return 0;
    return Math.abs(Number(item?.net_flow || 0)) / balance;
}

function flowMatchesChain(item, chain) {
    if (chain === 'all') return true;
    if (item?.chain_unresolved) return false;
    if (item?.chain) return item.chain === chain;
    if (Array.isArray(item?.flow_chains) && item.flow_chains.length) return item.flow_chains.includes(chain);
    if (item?.primary_flow_chain) return item.primary_flow_chain === chain;
    return false;
}

function isMeaningfulFlowItem(item, type) {
    const holder = getTrackedHolder(item.address);
    const balance = getFlowItemBalance(item, holder);
    const resolvedType = item.type || holder?.type || '';
    if (!holder || balance <= 0 || FLOW_INFRA_TYPES.has(resolvedType)) return false;

    const netFlow = Number(item?.net_flow || 0);
    if (type === 'accumulators') {
        if (netFlow <= 0) return false;
        const retentionRatio = getFlowRetentionRatio(item, balance);
        const netRetentionRatio = getFlowNetRetentionRatio(item);
        const balanceShare = getFlowBalanceShare(item, balance);
        const minBalance = Math.max(FLOW_MIN_BALANCE, Math.abs(netFlow) * FLOW_MIN_RETENTION);
        const keepsMeaningfulBalance = retentionRatio >= FLOW_MIN_RETENTION || balance >= minBalance;
        const meaningfulPeriodSignal = netFlow >= FLOW_MIN_BALANCE || netRetentionRatio >= FLOW_MIN_NET_RETENTION || balanceShare >= FLOW_MIN_BALANCE_SHARE;
        return keepsMeaningfulBalance && meaningfulPeriodSignal;
    }
    const balanceShare = getFlowBalanceShare(item, balance);
    return netFlow < 0 && (Math.abs(netFlow) >= FLOW_MIN_BALANCE || balanceShare >= FLOW_MIN_SELL_BALANCE_SHARE);
}

function getFlowCohort(item, holder=getTrackedHolder(item.address)) {
    if (item?.flow_cohort) return item.flow_cohort;
    const label = (item?.label || holder?.label || '').toLowerCase();
    const flowType = (item?.type || holder?.type || '').toUpperCase();
    if (label.includes('coinbase')) return 'coinbase';
    if (STRATEGIC_FLOW_TYPES.has(flowType)) return 'strategic';
    if (label.includes('investment recipient') || label.includes('borderless capital') || label.includes('strategic')) return 'strategic';
    return 'organic';
}

function getFlowCohortLabel(item, holder=getTrackedHolder(item.address)) {
    return item?.flow_cohort_label || FLOW_COHORT_LABELS[getFlowCohort(item, holder)] || FLOW_COHORT_LABELS.organic;
}

function getFlowAccumulationSource(item, holder=getTrackedHolder(item.address)) {
    if (item?.accumulation_source) return item.accumulation_source;
    const fundedBy = String(item?.funded_by || holder?.funded_by || '').toLowerCase();
    const freshProfile = String(item?.fresh_profile || holder?.fresh_profile || '').toLowerCase();
    if (fundedBy.includes('coinbase')) return 'coinbase_funded';
    if (fundedBy || freshProfile === 'cex_funded') return 'cex_funded';
    if (getFlowCohort(item, holder) === 'strategic') return 'strategic_inflow';
    return Number(item?.net_flow || 0) > 0 ? 'mixed_inflow' : 'unresolved_inflow';
}

function getFlowAccumulationSourceLabel(item, holder=getTrackedHolder(item.address)) {
    return item?.accumulation_source_label || ACCUMULATION_SOURCE_LABELS[getFlowAccumulationSource(item, holder)] || ACCUMULATION_SOURCE_LABELS.mixed_inflow;
}

function getFreshFlowSignal(item, holder=getTrackedHolder(item.address)) {
    if (item?.fresh_flow_signal) return item.fresh_flow_signal;
    const isFresh = item?.fresh_overlap === true
        || item?.type === 'FRESH'
        || item?.label === 'Fresh Wallet'
        || holder?.type === 'FRESH'
        || holder?.label === 'Fresh Wallet'
        || holder?.fresh === true;
    if (!isFresh) return '';
    if (Number(item?.net_flow || 0) < 0) return 'fresh_seller';
    const freshSignal = item?.fresh_signal || holder?.fresh_signal || '';
    if (freshSignal === 'fresh_whale_accumulator' || freshSignal === 'fresh_accumulator') return freshSignal;
    return 'fresh_wallet';
}

function getFreshFlowLabel(item, holder=getTrackedHolder(item.address)) {
    const signal = getFreshFlowSignal(item, holder);
    return signal ? (item?.fresh_flow_label || FRESH_FLOW_LABELS[signal] || FRESH_FLOW_LABELS.fresh_wallet) : '';
}

function isFreshFlowOverlap(item, holder=getTrackedHolder(item.address)) {
    return Boolean(getFreshFlowSignal(item, holder));
}

function getSellerProfile(item, holder=getTrackedHolder(item.address)) {
    if (item?.seller_profile) return item.seller_profile;
    const cohort = getFlowCohort(item, holder);
    if (cohort === 'coinbase') return 'coinbase_rotation';
    if (cohort === 'strategic') return 'strategic_rotation';
    return 'unresolved_outflow';
}

function getSellerProfileLabel(item, holder=getTrackedHolder(item.address)) {
    return item?.seller_profile_label || SELLER_PROFILE_LABELS[getSellerProfile(item, holder)] || SELLER_PROFILE_LABELS.unresolved_outflow;
}

function getSellPressureScore(item, holder=getTrackedHolder(item.address)) {
    const explicit = Number(item?.sell_pressure_score);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const balance = getFlowItemBalance(item, holder);
    const balanceShare = getFlowBalanceShare(item, balance);
    const sellerProfile = getSellerProfile(item, holder);
    const cexRatio = Number(item?.cex_outflow_ratio || 0);
    const externalRatio = Number(item?.external_outflow_ratio || 0);
    let pressure = 1 + (Math.min(balanceShare, 0.25) * 4) + (Math.min(cexRatio, 1) * 0.9) + (Math.min(externalRatio, 1) * 0.35);
    if (sellerProfile === 'coinbase_outflow') pressure += 0.55;
    else if (sellerProfile === 'cex_outflow') pressure += 0.45;
    else if (sellerProfile === 'mixed_outflow') pressure += 0.2;
    else if (sellerProfile === 'holder_redistribution') pressure = Math.max(0.8, pressure - 0.1);
    else if (sellerProfile === 'strategic_rotation') pressure = Math.max(0.75, pressure - 0.15);
    if (getFreshFlowSignal(item, holder) === 'fresh_seller') pressure += 0.08;
    return Math.abs(Number(item?.net_flow || 0)) * pressure;
}

function getFlowDisplayScore(item, type, holder=getTrackedHolder(item.address)) {
    const explicit = type === 'sellers' ? Number(item?.sell_pressure_score || item?.flow_score) : Number(item?.flow_score);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const balance = getFlowItemBalance(item, holder);
    const balanceShare = getFlowBalanceShare(item, balance);
    if (type === 'accumulators') {
        const retentionRatio = getFlowRetentionRatio(item, balance);
        const netRetentionRatio = getFlowNetRetentionRatio(item);
        let conviction = 1 + (Math.min(retentionRatio, 2) * 0.35) + (Math.min(netRetentionRatio, 1.5) * 0.55) + (Math.min(balanceShare, 0.25) * 2.5);
        const freshSignal = getFreshFlowSignal(item, holder);
        const accumulationSource = getFlowAccumulationSource(item, holder);
        if (freshSignal === 'fresh_whale_accumulator') conviction += 0.25;
        else if (freshSignal === 'fresh_accumulator') conviction += 0.18;
        else if (freshSignal) conviction += 0.08;
        if (accumulationSource === 'holder_built') conviction += 0.10;
        else if (accumulationSource === 'strategic_inflow' || accumulationSource === 'mixed_inflow') conviction += 0.05;
        return Math.max(0, Number(item?.net_flow || 0)) * conviction;
    }
    return getSellPressureScore(item, holder);
}
function getFlowSignalMeta(item, type, holder=getTrackedHolder(item.address)) {
    const score = getFlowDisplayScore(item, type, holder);
    const base = Math.max(Math.abs(Number(item?.net_flow || 0)), 1);
    const normalized = score / base;
    if (type === 'accumulators') {
        if (normalized >= 1.65) return { label: 'Prime conviction', shortLabel: 'Prime', className: 'flow-signal-prime', tone: 'prime', value: normalized };
        if (normalized >= 1.4) return { label: 'High conviction', shortLabel: 'High', className: 'flow-signal-high', tone: 'high', value: normalized };
        if (normalized >= 1.18) return { label: 'Watchlist build', shortLabel: 'Watch', className: 'flow-signal-watch', tone: 'watch', value: normalized };
        return { label: 'Tracked build', shortLabel: 'Track', className: 'flow-signal-track', tone: 'track', value: normalized };
    }
    if (normalized >= 2.2) return { label: 'Prime pressure', shortLabel: 'Prime', className: 'flow-signal-prime', tone: 'prime', value: normalized };
    if (normalized >= 1.8) return { label: 'High pressure', shortLabel: 'High', className: 'flow-signal-high', tone: 'high', value: normalized };
    if (normalized >= 1.35) return { label: 'Watch pressure', shortLabel: 'Watch', className: 'flow-signal-watch', tone: 'watch', value: normalized };
    return { label: 'Tracked trim', shortLabel: 'Track', className: 'flow-signal-track', tone: 'track', value: normalized };
}
function getFlowIntensityPct(item, type, holder=getTrackedHolder(item.address)) {
    const balance = getFlowItemBalance(item, holder);
    if (type === 'accumulators') {
        return Math.max(8, Math.min(100, Math.max(
            getFlowRetentionRatio(item, balance) * 36,
            getFlowNetRetentionRatio(item) * 100,
            getFlowBalanceShare(item, balance) * 280,
        )));
    }
    return Math.max(8, Math.min(100, Math.max(
        getFlowBalanceShare(item, balance) * 320,
        Number(item?.cex_outflow_ratio || 0) * 100,
        Number(item?.external_outflow_ratio || 0) * 75,
    )));
}
function flowSignalBadgeHTML(signalMeta, title='') {
    return `<span class="flow-signal-badge ${escapeAttr(signalMeta.className)}"${title ? ` title="${escapeAttr(title)}"` : ''}>${escapeHtml(signalMeta.shortLabel)}</span>`;
}
function flowIntensityBarHTML(pct, tone='neutral') {
    return `<div class="flow-intensity-bar"><div class="flow-intensity-fill tone-${escapeAttr(tone)}" style="width:${pct.toFixed(1)}%"></div></div>`;
}
function buildFlowWalletCell(item, holder, balance, balanceUsd) {
    return `<div class="flow-wallet-stack">${flowAddrCell(item)}<div class="flow-wallet-meta"><span class="flow-wallet-balance">${fmt(balance)} ZRO</span></div></div>`;
}
function buildFlowSignalCell(item, type, scoreMeta, intensityPct, flowUsd, holder, balance) {
    const isAcc = type === 'accumulators';
    return `<div class="flow-signal-stack"><div class="flow-signal-top">${flowSignalBadgeHTML(scoreMeta, scoreMeta.label)}<span class="flow-signal-amount">${isAcc ? '+' : ''}${fmt(item.net_flow)} ZRO</span></div>${flowIntensityBarHTML(intensityPct, isAcc ? 'buy' : 'sell')}</div>`;
}
function getAddressExplorerUrl(addr) {
    const chain = getMainChain(addr);
    return (EXPLORER_MAP[chain] || EXPLORER_MAP.ethereum) + addr;
}
function buildFlowDetailPayload(item, type, scoreMeta, flowUsd, balUsd, holder=getTrackedHolder(item.address)) {
    const addr = item.address;
    const shortA = shortAddr(addr);
    const explorerUrl = getAddressExplorerUrl(addr);
    const debankUrl = `https://debank.com/profile/${addr}`;
    const balance = getFlowItemBalance(item, holder);
    const retentionPct = (getFlowRetentionRatio(item, balance) * 100).toFixed(0);
    const balanceSharePct = (getFlowBalanceShare(item, balance) * 100).toFixed(1);
    const flowLabel = type === 'accumulators' ? 'Net accumulation' : 'Net distribution';
    const secondaryLabel = type === 'accumulators'
        ? getFlowAccumulationSourceLabel(item, holder)
        : getSellerProfileLabel(item, holder);
    return {
        eyebrow: type === 'accumulators' ? 'Accumulator profile' : 'Seller profile',
        title: item.label || shortA,
        subtitle: `${getFlowCohortLabel(item, holder)} · ${secondaryLabel}`,
        badges: [
            { label: scoreMeta.label, tone: scoreMeta.tone },
            { label: getFlowCohortLabel(item, holder), tone: getFlowCohort(item, holder) },
            ...(getFreshFlowSignal(item, holder) ? [{ label: getFreshFlowLabel(item, holder), tone: 'fresh' }] : []),
        ],
        metrics: [
            { label: flowLabel, value: `${Number(item.net_flow || 0) > 0 ? '+' : ''}${fmt(item.net_flow)} ZRO`, sub: fmtUSD(flowUsd) },
            { label: 'Current balance', value: `${fmt(balance)} ZRO`, sub: fmtUSD(balUsd) },
            { label: type === 'accumulators' ? 'Conviction' : 'Pressure', value: scoreMeta.value.toFixed(2), sub: scoreMeta.label },
        ],
        sectionTitle: 'Flow context',
        list: [
            { label: 'Address', value: shortA },
            { label: 'Cohort', value: getFlowCohortLabel(item, holder) },
            { label: type === 'accumulators' ? 'Source' : 'Outflow profile', value: secondaryLabel },
            { label: 'Retention / share', value: `${retentionPct}% retention`, sub: `${balanceSharePct}% of balance moved in selected window` },
            { label: 'Chain context', value: item.primary_flow_chain || (item.flow_chains || []).join(', ') || 'Unresolved' },
        ],
        actions: [
            { label: 'Open explorer', url: explorerUrl, primary: true },
            { label: 'Open in DeBank', url: debankUrl },
        ],
    };
}

function flowMatchesCohort(item, cohort) {
    if (cohort === 'all') return true;
    return getFlowCohort(item) === cohort;
}

function addrCell(item) {
    const addr=item.address, shortA=addr.slice(0,6)+'…'+addr.slice(-4);
    const explorerUrl = getAddressExplorerUrl(addr);
    const dbUrl=`https://debank.com/profile/${addr}`;
    const copyButton = copyButtonHTML(addr);
    const dbIcon = debankIconHTML(dbUrl);
    const explorerIcon = explorerIconHTML(explorerUrl, `View ${shortA} on explorer`);
    const cohort = getFlowCohort(item);
    const cohortBadge = `<span class="h-badge h-badge-flow-cohort h-badge-flow-${cohort}">${escapeHtml(getFlowCohortLabel(item))}</span>`;
    const sourceBadge = Number(item?.net_flow || 0) > 0
        ? `<span class="h-badge h-badge-flow-source">${escapeHtml(getFlowAccumulationSourceLabel(item))}</span>`
        : '';
    const sellerBadge = Number(item?.net_flow || 0) < 0
        ? `<span class="h-badge h-badge-flow-profile">${escapeHtml(getSellerProfileLabel(item))}</span>`
        : '';
    const freshSignal = getFreshFlowSignal(item);
    const freshBadge = freshSignal
        ? `<span class="h-badge h-badge-flow-fresh h-badge-flow-fresh-${escapeAttr(freshSignal)}">${escapeHtml(getFreshFlowLabel(item))}</span>`
        : '';
    if (item.label) {
        const bCls={'CEX':'h-badge-cex','DEX':'h-badge-dex','PROTOCOL':'h-badge-protocol','VC':'h-badge-vc','INST':'h-badge-inst','WALLET':'h-badge-wallet','TEAM':'h-badge-team','WHALE':'h-badge-whale','CUSTODY':'h-badge-custody','MULTISIG':'h-badge-multisig','MM':'h-badge-mm','FRESH':'h-badge-fresh','UNLOCK':'h-badge-unlock','NEW_INST':'h-badge-inst'}[item.type]||'h-badge-whale';
        return `<div class="h-addr-two-line"><div class="h-addr-line1"><a href="${explorerUrl}" target="_blank" rel="noopener noreferrer" class="h-addr-label">${item.label}</a><span class="h-badge ${bCls}">${item.type}</span>${cohortBadge}${sourceBadge}${sellerBadge}${freshBadge}</div><div class="h-addr-line2"><span class="h-addr-hex-sm">${shortA}</span>${copyButton}${dbIcon}${explorerIcon}</div></div>`;
    }
    return `<div class="h-addr-two-line"><div class="h-addr-line1"><a href="${explorerUrl}" target="_blank" rel="noopener noreferrer" class="h-addr-hex">${shortA}</a>${cohortBadge}${sourceBadge}${sellerBadge}${freshBadge}${copyButton}${dbIcon}${explorerIcon}</div></div>`;
}
function flowAddrCell(item) {
    const addr = item.address;
    const shortA = shortAddr(addr);
    const explorerUrl = getAddressExplorerUrl(addr);
    const copyButton = copyButtonHTML(addr);
    const dbIcon = debankIconHTML(`https://debank.com/profile/${addr}`);
    const explorerIcon = explorerIconHTML(explorerUrl, `View ${shortA} on explorer`);
    const cohort = getFlowCohort(item);
    const cohortBadge = `<span class="h-badge h-badge-flow-cohort h-badge-flow-${cohort}">${escapeHtml(getFlowCohortLabel(item))}</span>`;
    const freshSignal = getFreshFlowSignal(item);
    const freshBadge = freshSignal
        ? `<span class="h-badge h-badge-flow-fresh h-badge-flow-fresh-${escapeAttr(freshSignal)}">${escapeHtml(getFreshFlowLabel(item))}</span>`
        : '';
    const bCls = {'CEX':'h-badge-cex','DEX':'h-badge-dex','PROTOCOL':'h-badge-protocol','VC':'h-badge-vc','INST':'h-badge-inst','WALLET':'h-badge-wallet','TEAM':'h-badge-team','WHALE':'h-badge-whale','CUSTODY':'h-badge-custody','MULTISIG':'h-badge-multisig','MM':'h-badge-mm','FRESH':'h-badge-fresh','UNLOCK':'h-badge-unlock','NEW_INST':'h-badge-inst'}[item.type] || 'h-badge-whale';
    const typeBadge = item.label ? `<span class="h-badge ${bCls}">${escapeHtml(item.type || 'Wallet')}</span>` : '';
    if (item.label) {
        return `<div class="h-addr-two-line flow-addr-compact"><div class="h-addr-line1"><a href="${explorerUrl}" target="_blank" rel="noopener noreferrer" class="h-addr-label">${item.label}</a>${typeBadge}${freshBadge}</div><div class="h-addr-line2">${cohortBadge}<span class="h-addr-hex-sm">${shortA}</span>${copyButton}${dbIcon}${explorerIcon}</div></div>`;
    }
    return `<div class="h-addr-two-line flow-addr-compact"><div class="h-addr-line1"><a href="${explorerUrl}" target="_blank" rel="noopener noreferrer" class="h-addr-hex">${shortA}</a>${freshBadge}</div><div class="h-addr-line2">${cohortBadge}${copyButton}${dbIcon}${explorerIcon}</div></div>`;
}

// ── Tabs ──
function setActiveTab(tabId, options = {}) {
    const nextTab = ['overview', 'flows', 'tokenomics'].includes(tabId) ? tabId : 'overview';
    activeTab = nextTab;
    closeDetailDrawer();
    document.querySelectorAll('.tab-btn').forEach(btn => {
        const isActive = btn.dataset.tab === nextTab;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', String(isActive));
    });
    document.querySelectorAll('.tab-view').forEach(view => view.classList.toggle('active', view.id === `view-${nextTab}`));
    if (options.syncUrl !== false) {
        requestHistoryMode(options.historyMode || 'push');
        updateUrlState();
    }
}
function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.setAttribute('aria-selected', String(btn.classList.contains('active')));
    });
}
function applyStateFromUrl() {
    const params = new URLSearchParams(window.location.search);
    activeTab = pickAllowedValue(params.get('tab'), ['overview', 'flows', 'tokenomics'], 'overview');
    currentPeriod = pickAllowedValue(params.get('flowPeriod'), ['1d', '7d', '30d', '90d', '180d', 'all'], '30d');

    holdersSearchQuery = params.get('holdersSearch')?.trim() || '';
    holdersSortKey = pickAllowedValue(params.get('holdersSort'), ['address', 'total', ...CHAIN_KEYS], 'total');
    holdersSortDir = pickAllowedValue(params.get('holdersDir'), ['asc', 'desc'], holdersSortKey === 'address' ? 'asc' : 'desc');
    holdersHideEntities = parseBooleanParam(params.get('holdersHide'));
    holdersPage = parsePositiveInt(params.get('holdersPage'), 1);

    freshSearchQuery = params.get('freshSearch')?.trim() || '';
    freshSortKey = pickAllowedValue(params.get('freshSort'), ['signal', 'date', 'flow', 'balance'], 'signal');
    freshSortDir = pickAllowedValue(params.get('freshDir'), ['asc', 'desc'], 'desc');
    freshFilterMode = pickAllowedValue(params.get('freshFilter'), ['all', 'accumulators', 'whales'], 'all');
    freshPage = parsePositiveInt(params.get('freshPage'), 1);

    cbSearchQuery = params.get('cbSearch')?.trim() || '';
    cbPeriodDays = Number.parseInt(pickAllowedValue(params.get('cbPeriod'), ['0', '1', '7', '30', '90', '180'], '0'), 10);
    cbSortKey = pickAllowedValue(params.get('cbSort'), ['date', 'flow', 'balance'], 'balance');
    cbSortDir = pickAllowedValue(params.get('cbDir'), ['asc', 'desc'], 'desc');
    cbPage = parsePositiveInt(params.get('cbPage'), 1);

    cbtSearchQuery = params.get('cbtSearch')?.trim() || '';
    cbtTypeFilter = pickAllowedValue(params.get('cbtType'), ['ALL', 'BUY', 'SELL', 'TRANSFER', 'OUTFLOW', 'INFLOW'], 'ALL');
    cbtPeriodDays = Number.parseInt(pickAllowedValue(params.get('cbtPeriod'), ['0', '1', '7', '30', '90', '180'], '0'), 10);
    const rawCbtSort = params.get('cbtSort');
    if (['0', '1', '2'].includes(rawCbtSort)) {
        cbtSortKey = rawCbtSort === '0' ? 'date' : 'amount';
        cbtSortDir = rawCbtSort === '2' ? 'asc' : 'desc';
    } else {
        cbtSortKey = pickAllowedValue(rawCbtSort, ['date', 'amount'], 'date');
        cbtSortDir = pickAllowedValue(params.get('cbtDir'), ['asc', 'desc'], 'desc');
    }
    cbtPage = parsePositiveInt(params.get('cbtPage'), 1);

    flowSearchQuery = params.get('flowSearch')?.trim() || '';
    flowChain = pickAllowedValue(params.get('flowChain'), ['all', ...Object.keys(DATA.chains || {})], 'all');
    flowCohort = pickAllowedValue(params.get('flowCohort'), ['all', 'organic', 'strategic', 'coinbase'], 'all');
    hideCex = params.get('hideCex') == null ? true : parseBooleanParam(params.get('hideCex'));
    flowPageAcc = parsePositiveInt(params.get('flowAccPage'), 1);
    flowPageSell = parsePositiveInt(params.get('flowSellPage'), 1);

    whaleFilter = pickAllowedValue(params.get('whaleFilter'), ['ALL', 'BUY', 'SELL', 'MOVE'], 'ALL');
    whalePageNum = parsePositiveInt(params.get('whalePage'), 1);
}
function updateUrlState(modeOverride) {
    if (!stateSyncReady) return;
    const params = new URLSearchParams();

    if (activeTab !== 'overview') params.set('tab', activeTab);
    if (currentPeriod !== '30d') params.set('flowPeriod', currentPeriod);

    if (holdersSearchQuery) params.set('holdersSearch', holdersSearchQuery);
    if (holdersSortKey !== 'total') params.set('holdersSort', holdersSortKey);
    if (holdersSortDir !== 'desc') params.set('holdersDir', holdersSortDir);
    if (holdersHideEntities) params.set('holdersHide', '1');
    if (holdersPage !== 1) params.set('holdersPage', String(holdersPage));

    if (freshSearchQuery) params.set('freshSearch', freshSearchQuery);
    if (freshSortKey !== 'signal') params.set('freshSort', freshSortKey);
    if (freshSortDir !== 'desc') params.set('freshDir', freshSortDir);
    if (freshFilterMode !== 'all') params.set('freshFilter', freshFilterMode);
    if (freshPage !== 1) params.set('freshPage', String(freshPage));

    if (cbSearchQuery) params.set('cbSearch', cbSearchQuery);
    if (cbPeriodDays !== 0) params.set('cbPeriod', String(cbPeriodDays));
    if (cbSortKey !== 'balance') params.set('cbSort', cbSortKey);
    if (cbSortDir !== 'desc') params.set('cbDir', cbSortDir);
    if (cbPage !== 1) params.set('cbPage', String(cbPage));

    if (cbtSearchQuery) params.set('cbtSearch', cbtSearchQuery);
    if (cbtTypeFilter !== 'ALL') params.set('cbtType', cbtTypeFilter);
    if (cbtPeriodDays !== 0) params.set('cbtPeriod', String(cbtPeriodDays));
    if (cbtSortKey !== 'date') params.set('cbtSort', cbtSortKey);
    if (cbtSortDir !== 'desc') params.set('cbtDir', cbtSortDir);
    if (cbtPage !== 1) params.set('cbtPage', String(cbtPage));

    if (flowSearchQuery) params.set('flowSearch', flowSearchQuery);
    if (flowChain !== 'all') params.set('flowChain', flowChain);
    if (flowCohort !== 'all') params.set('flowCohort', flowCohort);
    if (!hideCex) params.set('hideCex', '0');
    if (flowPageAcc !== 1) params.set('flowAccPage', String(flowPageAcc));
    if (flowPageSell !== 1) params.set('flowSellPage', String(flowPageSell));

    if (whaleFilter !== 'ALL') params.set('whaleFilter', whaleFilter);
    if (whalePageNum !== 1) params.set('whalePage', String(whalePageNum));

    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const historyMode = modeOverride || nextHistoryMode;
    nextHistoryMode = 'replace';
    if (nextUrl !== currentUrl) {
        history[historyMode === 'push' ? 'pushState' : 'replaceState'](null, '', nextUrl);
    }
}
function syncControlsFromState() {
    setInputValue('holders-search', holdersSearchQuery);
    setCheckboxValue('holders-hide-cex', holdersHideEntities);
    setInputValue('fresh-search', freshSearchQuery);
    setActiveDataChoice('fresh-filter-pills', 'freshFilter', freshFilterMode);
    setInputValue('cb-search', cbSearchQuery);
    setInputValue('cbt-search', cbtSearchQuery);
    setInputValue('flow-search', flowSearchQuery);
    setActiveDataChoice('whale-filter-pills', 'whaleFilter', whaleFilter);

    setActivePill('flow-period-pills', currentPeriod);
    setActiveDataChoice('flow-cohort-pills', 'flowCohort', flowCohort);
    setActivePill('cb-period-pills', cbPeriodDays);
    setActivePill('cbt-period-pills', cbtPeriodDays);
    setCbtTypeTriggerLabel();

    const trigger = document.getElementById('chain-dd-trigger');
    const chainLabel = flowChain === 'all' ? 'All Chains' : (DATA.chains[flowChain]?.short || 'All Chains');
    setText('chain-dd-label', chainLabel);
    if (trigger) {
        trigger.classList.toggle('active', flowChain !== 'all');
        trigger.setAttribute('aria-expanded', 'false');
    }

    const flowHideButton = document.getElementById('flow-hide-cex');
    if (flowHideButton) {
        flowHideButton.classList.toggle('active', hideCex);
        flowHideButton.setAttribute('aria-pressed', String(hideCex));
    }

    setActiveTab(activeTab, { syncUrl: false });
}
function handlePageButtonClick(target, delta) {
    switch (target) {
        case 'holders': goHoldersPage(delta); break;
        case 'fresh': goFreshPage(delta); break;
        case 'cb': goCbPage(delta); break;
        case 'cbt': goCbtPage(delta); break;
        case 'flow-acc': goFlowPage('acc', delta); break;
        case 'flow-sell': goFlowPage('sell', delta); break;
        case 'whale': goWhalePage(delta); break;
        default: break;
    }
}
function handleDelegatedInput(event) {
    switch (event.target.id) {
        case 'holders-search': filterHolders(); break;
        case 'fresh-search': filterFresh(); break;
        case 'cb-search': filterCb(); break;
        case 'cbt-search': filterCbt(); break;
        case 'flow-search': filterFlows(); break;
        default: break;
    }
}
function handleDelegatedChange(event) {
    if (event.target.id === 'holders-hide-cex') {
        holdersHideEntities = event.target.checked;
        holdersPage = 1;
        requestHistoryMode('push');
        renderHolders();
    }
}
function handleDelegatedClick(event) {
    const drawerClose = event.target.closest('[data-drawer-close], #detail-drawer-backdrop');
    if (drawerClose) {
        closeDetailDrawer();
        return;
    }

    const copyBtn = event.target.closest('[data-copy]');
    if (copyBtn) {
        event.preventDefault();
        copyText(copyBtn.dataset.copy);
        return;
    }

    const tabBtn = event.target.closest('.tab-btn[data-tab]');
    if (tabBtn) {
        setActiveTab(tabBtn.dataset.tab);
        return;
    }

    const holdersSortTrigger = event.target.closest('[data-holders-sort]');
    if (holdersSortTrigger) {
        sortHolders(holdersSortTrigger.dataset.holdersSort);
        return;
    }

    const freshSortTrigger = event.target.closest('[data-fresh-sort]');
    if (freshSortTrigger) {
        toggleFreshSort(freshSortTrigger.dataset.freshSort);
        return;
    }

    const freshFilterButton = event.target.closest('[data-fresh-filter]');
    if (freshFilterButton) {
        setFreshFilter(freshFilterButton.dataset.freshFilter);
        return;
    }

    const freshFilterTarget = event.target.closest('[data-fresh-filter-target]');
    if (freshFilterTarget) {
        setFreshFilter(freshFilterTarget.dataset.freshFilterTarget);
        return;
    }

    const cbSortTrigger = event.target.closest('[data-cb-sort]');
    if (cbSortTrigger) {
        toggleCbSort(cbSortTrigger.dataset.cbSort);
        return;
    }

    const cbtToggle = event.target.closest('[data-cbt-toggle]');
    if (cbtToggle) {
        toggleCbtTypeDropdown();
        return;
    }

    const cbtTypeButton = event.target.closest('[data-cbt-type]');
    if (cbtTypeButton) {
        setCbtType(cbtTypeButton.dataset.cbtType);
        return;
    }

    const flowChainToggle = event.target.closest('[data-flow-chain-toggle]');
    if (flowChainToggle) {
        toggleChainDropdown();
        return;
    }

    const flowChainButton = event.target.closest('[data-flow-chain]');
    if (flowChainButton) {
        setFlowChain(flowChainButton.dataset.flowChain, flowChainButton.dataset.flowLabel);
        return;
    }

    const flowCohortButton = event.target.closest('[data-flow-cohort]');
    if (flowCohortButton) {
        setFlowCohort(flowCohortButton.dataset.flowCohort);
        return;
    }

    const flowHideButton = event.target.closest('#flow-hide-cex');
    if (flowHideButton) {
        toggleHideCex();
        return;
    }

    const whaleFilterButton = event.target.closest('[data-whale-filter]');
    if (whaleFilterButton) {
        setWhaleFilter(whaleFilterButton.dataset.whaleFilter);
        return;
    }

    const pageButton = event.target.closest('[data-page-target]');
    if (pageButton) {
        handlePageButtonClick(pageButton.dataset.pageTarget, Number.parseInt(pageButton.dataset.pageDelta, 10));
        return;
    }

    const detailTarget = event.target.closest('[data-detail-key]');
    if (detailTarget && !event.target.closest('a, button, input, label') && isCompactTableMode()) {
        openDetailDrawer(detailTarget.dataset.detailKey);
        return;
    }

    const row = event.target.closest('[data-nav-url]');
    if (row) {
        if (event.target.closest('a, button, input, label')) return;
        navigateToExternal(row.dataset.navUrl);
    }
}
function handleDelegatedKeydown(event) {
    if (event.key === 'Escape' && activeDrawerKey) {
        closeDetailDrawer();
        return;
    }
    const freshFilterTarget = event.target.closest('[data-fresh-filter-target]');
    if (freshFilterTarget && event.target === freshFilterTarget && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        setFreshFilter(freshFilterTarget.dataset.freshFilterTarget);
        return;
    }
    const detailTarget = event.target.closest('[data-detail-key]');
    if (detailTarget && event.target === detailTarget && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        if (isCompactTableMode()) openDetailDrawer(detailTarget.dataset.detailKey);
        else if (detailTarget.dataset.navUrl) navigateToExternal(detailTarget.dataset.navUrl);
        return;
    }
    const row = event.target.closest('[data-nav-url]');
    if (!row || event.target !== row) return;
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        navigateToExternal(row.dataset.navUrl);
    }
}
function handleDelegatedAssetError(event) {
    if (!(event.target instanceof HTMLImageElement)) return;
    if (!event.target.classList.contains('h-debank-favicon')) return;
    const parentLink = event.target.closest('.h-debank-icon');
    if (parentLink) parentLink.style.display = 'none';
}
function closeCbtTypeDropdown() {
    const menu = document.getElementById('cbt-type-menu');
    const trigger = document.getElementById('cbt-type-trigger');
    if (!menu || !trigger) return;
    menu.classList.remove('open');
    trigger.classList.remove('active');
    trigger.setAttribute('aria-expanded', 'false');
}
function closeFlowChainDropdown() {
    const menu = document.getElementById('chain-dd-menu');
    const trigger = document.getElementById('chain-dd-trigger');
    if (!menu || !trigger) return;
    menu.classList.remove('open');
    trigger.classList.toggle('active', flowChain !== 'all');
    trigger.setAttribute('aria-expanded', 'false');
}
function closeFloatingMenus(except = null) {
    if (except !== 'cbt') closeCbtTypeDropdown();
    if (except !== 'flow-chain') closeFlowChainDropdown();
}
function handleDocumentPointerDown(event) {
    const cbtDropdown = document.getElementById('cbt-type-dropdown');
    if (cbtDropdown && !cbtDropdown.contains(event.target)) closeCbtTypeDropdown();
    const flowDropdown = document.getElementById('chain-dropdown');
    if (flowDropdown && !flowDropdown.contains(event.target)) closeFlowChainDropdown();
}
function initEventDelegation() {
    document.addEventListener('input', handleDelegatedInput);
    document.addEventListener('change', handleDelegatedChange);
    document.addEventListener('click', handleDelegatedClick);
    document.addEventListener('pointerdown', handleDocumentPointerDown);
    document.addEventListener('keydown', handleDelegatedKeydown);
    document.addEventListener('error', handleDelegatedAssetError, true);
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('resize', () => {
        if (!DATA) return;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            const nextMode = isCompactTableMode();
            if (nextMode === compactTableMode) return;
            compactTableMode = nextMode;
            closeDetailDrawer();
            renderStatefulViews();
        }, 120);
    });
}
function renderStatefulViews() {
    detailRegistry.clear();
    closeDetailDrawer();
    syncControlsFromState();
    renderHolders();
    renderFreshWallets();
    renderCoinbasePrime();
    renderCbTransfers();
    renderNewInstitutional();
    renderFlows();
    renderWhaleTransfers();
}
function handlePopState() {
    if (!DATA) return;
    applyStateFromUrl();
    renderStatefulViews();
}

// ── Price + Circulating Supply (live from CoinGecko) ──
async function fetchPrice() {
    try {
        const r=await fetch('https://api.coingecko.com/api/v3/coins/layerzero?localization=false&tickers=false&community_data=false&developer_data=false');
        if (!r.ok) throw new Error(`CoinGecko ${r.status}`);
        const j=await r.json();
        if (j.market_data) {
            const md=j.market_data;
            const prevPrice = DATA.meta.price_usd;
            DATA.meta.price_usd=md.current_price.usd;
            DATA.meta.circulating_supply=md.circulating_supply||DATA.meta.circulating_supply;
            DATA.meta.market_cap=md.market_cap.usd||DATA.meta.market_cap;
            DATA.meta.fdv=md.fully_diluted_valuation.usd||DATA.meta.fdv;
            DATA.meta.price_change_24h=typeof md.price_change_percentage_24h === 'number' ? md.price_change_percentage_24h : DATA.meta.price_change_24h;
            renderMetrics();
            if (prevPrice !== DATA.meta.price_usd) rerenderPriceSensitiveViews();
            const ch=md.price_change_percentage_24h;
            if (typeof ch === 'number') {
                document.getElementById('m-price-src').innerHTML=`Live via CoinGecko · <span style="color:${ch>=0?'var(--accent-green)':'var(--accent-rose)'}">${ch>=0?'+':''}${ch.toFixed(2)}% 24h</span>`;
            } else {
                setText('m-price-src', 'Live via CoinGecko');
            }
        }
    } catch(e) { console.warn('CoinGecko failed',e); }
}

function renderMetrics() {
    const m=DATA.meta;
    const totalSupply = m.total_supply || DATA.total_supply || 0;
    setText('m-circ', fmt(m.circulating_supply));
    setText('m-circ-pct', totalSupply ? ((m.circulating_supply/totalSupply)*100).toFixed(1)+'% of total' : '—');
    setText('m-price', fmtUSD(m.price_usd));
    setText('m-mcap', fmtUSD(m.market_cap));
    setText('m-fdv', fmtUSD(m.fdv));
    renderHeaderStatus();
}
function renderHeaderStatus() {
    const container = document.getElementById('header-status-grid');
    if (!container || !DATA?.meta) return;
    const totalSupply = DATA.meta.total_supply || DATA.total_supply || 0;
    const circulatingSupply = DATA.meta.circulating_supply || 0;
    const circulatingPct = totalSupply ? ((circulatingSupply / totalSupply) * 100).toFixed(1) : '—';
    const trackedCount = DATA.top_holders?.length || 0;
    const freshUniverse = getFreshWalletUniverse();
    const whaleAccumulatorCount = freshUniverse.filter(holder => holder.fresh_signal === 'fresh_whale_accumulator').length;
    const snapshotMeta = getSnapshotStatusMeta();
    const priceChange = Number(DATA.meta.price_change_24h);
    const priceChangeCopy = Number.isFinite(priceChange)
        ? `${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}% 24h`
        : 'live from CoinGecko';
    const snapshotClass = snapshotMeta ? ` is-${snapshotMeta.status}` : '';
    const snapshotValue = snapshotMeta ? snapshotMeta.ageLabel : '—';
    const snapshotSub = snapshotMeta ? `${snapshotMeta.chipLabel} · ${snapshotMeta.absoluteLabel}` : 'Indexed snapshot status unavailable';

    container.innerHTML = `
        <div class="header-status-card">
            <span class="header-status-label">Live Price</span>
            <span class="header-status-value">${fmtUSD(DATA.meta.price_usd)}</span>
            <span class="header-status-sub${Number.isFinite(priceChange) ? (priceChange >= 0 ? ' positive' : ' negative') : ''}">${priceChangeCopy}</span>
        </div>
        <div class="header-status-card">
            <span class="header-status-label">Circulating</span>
            <span class="header-status-value">${fmt(circulatingSupply)}</span>
            <span class="header-status-sub">${circulatingPct}% of 1B supply</span>
        </div>
        <div class="header-status-card">
            <span class="header-status-label">Tracked Wallets</span>
            <span class="header-status-value">${trackedCount.toLocaleString()}</span>
            <span class="header-status-sub">${whaleAccumulatorCount} whale accumulators flagged</span>
        </div>
        <div class="header-status-card header-status-card-accent${snapshotClass}">
            <span class="header-status-label">Snapshot Age</span>
            <span class="header-status-value">${snapshotValue}</span>
            <span class="header-status-sub">${snapshotSub}</span>
        </div>
    `;
}
function rerenderPriceSensitiveViews() {
    renderHolders();
    renderFreshWallets();
    renderCoinbasePrime();
    renderCbTransfers();
    renderFlows();
    renderWhaleTransfers();
    renderVesting();
}

function renderNetworkStats() {
    const m=DATA.meta;
    document.getElementById('s-volume').textContent=fmtUSD(m.q4_2025_volume);
    document.getElementById('s-mau').textContent=fmt(m.monthly_active_users);
    document.getElementById('s-chains').textContent=m.connected_chains+'+';
    document.getElementById('s-apps').textContent=m.apps+'+';
    document.getElementById('s-stable').textContent=m.cross_chain_stablecoin_share+'%';
    document.getElementById('s-oft').textContent=m.oft_count+'+';
}

function renderChains() {
    const trackedBalances = DATA.meta?.integrity?.tracked_chain_balances || {};
    const anomalies = DATA.meta?.integrity?.chain_balance_anomalies || [];
    const entries=Object.entries(DATA.chains).map(([chain, config]) => [chain, {
        ...config,
        trackedBalance: trackedBalances[chain] || 0,
        configuredSupply: config.supply || 0,
        anomalous: anomalies.some(item => item.chain === chain),
    }]).sort((a,b)=>b[1].trackedBalance-a[1].trackedBalance);
    const totalTracked=entries.reduce((sum,[,config])=>sum+config.trackedBalance,0);
    const configuredTotal=entries.reduce((sum,[,config])=>sum+config.configuredSupply,0);
    const totalHolders=entries.reduce((s,[,c])=>s+c.holders,0);
    const maxTracked=Math.max(...entries.map(([,c])=>c.trackedBalance), 0);
    const maxHolders=Math.max(...entries.map(([,c])=>c.holders));
    const totalDriftPct = configuredTotal ? ((totalTracked - configuredTotal) / configuredTotal) * 100 : 0;
    const snapshotSupplySynced = entries.some(([, config]) => config.supply_source === 'indexed_holder_snapshot');
    const noteClass = anomalies.length || Math.abs(totalDriftPct) > 0.5 ? ' warn' : '';
    const noteText = anomalies.length
        ? `Using indexed holder balances for distribution. ${anomalies.length} chain snapshot${anomalies.length > 1 ? 's' : ''} currently exceed configured supply, so treat per-chain supply as approximate until the dataset is regenerated.`
        : snapshotSupplySynced
            ? 'Using indexed holder balances for distribution and snapshot-synced per-chain supply from the current holder universe.'
            : 'Using indexed holder balances for distribution and configured holder counts for coverage.';
    document.getElementById('chain-bars').innerHTML=`<div class="chain-integrity-note${noteClass}">${noteText}</div>`+entries.map(([k,c])=>{
        const pct=maxTracked ? (c.trackedBalance/maxTracked*100).toFixed(1) : '0.0';
        const sPct=totalTracked ? (c.trackedBalance/totalTracked*100).toFixed(1) : '0.0';
        const configuredHint = c.anomalous ? `<div class="chain-bar-sub">Cfg ${fmt(c.configuredSupply)}</div>` : '';
        return `<a class="chain-bar-row" href="${c.explorer}" target="_blank" rel="noopener noreferrer" aria-label="Open ${c.name} explorer"><div class="chain-bar-label"><span class="chain-dot" style="background:${c.color}"></span>${c.short}</div><div class="chain-bar-track"><div class="chain-bar-fill" style="width:${pct}%;background:${c.color}">${sPct}%</div></div><div class="chain-bar-value">${fmt(c.trackedBalance)}${configuredHint}</div></a>`;
    }).join('');
    document.getElementById('chain-stats').innerHTML=`
        ${entries.map(([k,c])=>{
            const hPct=(c.holders/maxHolders*100).toFixed(0);
            const hShare=(c.holders/totalHolders*100).toFixed(1);
            return `<div class="chain-stat-row" style="gap:8px;align-items:center">
                <div class="chain-stat-label" style="width:70px;flex-shrink:0"><span class="chain-dot" style="background:${c.color};width:8px;height:8px"></span>${c.short}</div>
                <div style="flex:1;height:6px;background:rgba(255,255,255,0.04);border-radius:3px;overflow:hidden"><div style="height:100%;width:${hPct}%;background:${c.color};border-radius:3px"></div></div>
                <div style="width:75px;text-align:right;font-size:12px;font-weight:600;color:var(--text-primary);font-variant-numeric:tabular-nums">${c.holders.toLocaleString()}</div>
                <div style="width:42px;text-align:right;font-size:10px;color:var(--text-muted)">${hShare}%</div>
            </div>`;
        }).join('')}`;
}

// ── Hodlers — pill-toggle chain filter + clean headers ──
const CHAIN_KEYS = ['ethereum','arbitrum','base','bsc','optimism','polygon','avalanche'];
const CHAIN_COLORS = {ethereum:'#627EEA',arbitrum:'#2D374B',base:'#0052FF',bsc:'#F0B90B',optimism:'#FF0420',polygon:'#8247E5',avalanche:'#E84142'};
const CHAIN_EXPLORERS = {
    ethereum:'https://etherscan.io/address/',arbitrum:'https://arbiscan.io/address/',
    base:'https://basescan.org/address/',bsc:'https://bscscan.com/address/',
    optimism:'https://optimistic.etherscan.io/address/',polygon:'https://polygonscan.com/address/',
    avalanche:'https://snowtrace.io/address/'
};
const CHAIN_ICONS = {
    ethereum:'https://icons.llamao.fi/icons/chains/rsz_ethereum.jpg',
    arbitrum:'https://icons.llamao.fi/icons/chains/rsz_arbitrum.jpg',
    base:'https://icons.llamao.fi/icons/chains/rsz_base.jpg',
    bsc:'https://icons.llamao.fi/icons/chains/rsz_binance.jpg',
    optimism:'https://icons.llamao.fi/icons/chains/rsz_optimism.jpg',
    polygon:'https://icons.llamao.fi/icons/chains/rsz_polygon.jpg',
    avalanche:'https://icons.llamao.fi/icons/chains/rsz_avalanche.jpg'
};
let activeChains = new Set(CHAIN_KEYS);
function getFilteredHolders() {
    let items=[...DATA.top_holders];
    if(holdersSearchQuery) { const q=holdersSearchQuery.toLowerCase(); items=items.filter(h=>h.address.toLowerCase().includes(q)||(h.label&&h.label.toLowerCase().includes(q))); }
    if(holdersHideEntities) items=items.filter(h=>!HIDDEN_HOLDER_ENTITY_TYPES.has(h.type));
    items.sort((a,b)=>{
        if(holdersSortKey==='address'){const va=(a.label||a.address).toLowerCase(),vb=(b.label||b.address).toLowerCase();return holdersSortDir==='asc'?va.localeCompare(vb):vb.localeCompare(va);}
        const va=holdersSortKey==='total'?getDisplayBalance(a):(a.balances[holdersSortKey]||0);
        const vb=holdersSortKey==='total'?getDisplayBalance(b):(b.balances[holdersSortKey]||0);
        return holdersSortDir==='asc'?va-vb:vb-va;
    });
    return items;
}
function getDisplayBalance(h) {
    return getHolderTotalBalance(h);
}
function renderHolders() {
    const compactMode = isCompactTableMode();
    const visChains=CHAIN_KEYS.filter(k=>activeChains.has(k));
    const numCols=visChains.length;
    // Colgroup — only visible chains
    document.getElementById('holders-colgroup').innerHTML=
        `<col class="hcol-rank"><col class="hcol-addr">` +
        visChains.map(()=>`<col class="hcol-chain">`).join('') +
        `<col class="hcol-total">`;
    // Thead — exact Dolomite style
    const sa=k=>{
        if(holdersSortKey!==k) return '<span class="sort-arrow">⇅</span>';
        return `<span class="sort-arrow active">${holdersSortDir==='desc'?'▼':'▲'}</span>`;
    };
    let thead=`<tr>
        <th class="h-th">#</th>
        <th class="h-th sortable" data-holders-sort="address">Address ${sa('address')}</th>`;
    visChains.forEach(k=>{
        const c=DATA.chains[k];
        thead+=`<th class="h-th h-th-chain sortable" style="color:${c.color}" data-holders-sort="${k}">
            <div class="h-chain-hdr"><img src="${CHAIN_ICONS[k]}" width="16" height="16" class="h-chain-icon" alt="${c.short}"><span class="h-chain-name">${c.short}</span> ${sa(k)}</div>
        </th>`;
    });
    thead+=`<th class="h-th h-th-chain sortable" style="color:#fff" data-holders-sort="total">⚪ Balance ${sa('total')}</th></tr>`;
    document.getElementById('holders-thead').innerHTML=thead;
    // Tbody
    const items=getFilteredHolders(), totalPages=Math.max(1,Math.ceil(items.length/HOLDERS_PER_PAGE));
    if(holdersPage>totalPages) holdersPage=totalPages;
    const start=(holdersPage-1)*HOLDERS_PER_PAGE, page=items.slice(start,start+HOLDERS_PER_PAGE);
    const colCount=2+numCols+1;
    let html='';
    const price=DATA.meta.price_usd||0;
    if (!items.length) {
        const detail = holdersSearchQuery
            ? `No holder matches "${holdersSearchQuery}" in the current indexed snapshot.`
            : holdersHideEntities
                ? 'All visible wallets are currently filtered out by the entity toggle.'
                : 'Holder data will appear here once the indexed snapshot is loaded.';
        html = `<tr><td class="h-td" colspan="${colCount}">${tableEmptyStateHTML(holdersSearchQuery ? '🔍' : '🪙', holdersSearchQuery ? 'No matching holders' : 'No holders to display', detail)}</td></tr>`;
    }
    page.forEach((h,idx)=>{
        const dbUrl=`https://debank.com/profile/${h.address}`;
        const shortA=h.address.slice(0,6)+'…'+h.address.slice(-4);
        const dispBal=getDisplayBalance(h);
        const usdVal=dispBal*price;
        const dbIcon=debankIconHTML(dbUrl);
        const copyButton=copyButtonHTML(h.address);
        const detailKey = `holder:${h.address}`;
        const detailPayload = buildWalletDrawerPayload(h, {
            eyebrow: `Tracked holder #${start + idx + 1}`,
            title: h.label || 'Tracked wallet',
            badges: h.type ? [{ label: h.type, tone: String(h.type).toLowerCase() }] : [],
            metrics: [
                { value: `${fmt(dispBal)} ZRO`, label: 'Total balance', sub: price ? fmtUSD(usdVal) : 'Live price unavailable' },
                { value: `${getHolderSupplyPct(h).toFixed(4)}%`, label: 'Supply share', sub: `${getPositiveChainBalances(h).length} active chains` },
            ],
        });
        let addrTd;
        if(h.label){
            const bCls={'CEX':'h-badge-cex','PROTOCOL':'h-badge-protocol','INST':'h-badge-inst','VC':'h-badge-vc','DEX':'h-badge-dex','TEAM':'h-badge-team','WHALE':'h-badge-whale','CUSTODY':'h-badge-custody','MULTISIG':'h-badge-multisig','MM':'h-badge-mm','FRESH':'h-badge-fresh','UNLOCK':'h-badge-unlock','NEW_INST':'h-badge-inst'}[h.type]||'h-badge-whale';
            addrTd=`<td class="h-td h-td-addr"${dataLabelAttr('Address')}><div class="h-addr-two-line"><div class="h-addr-line1"><a href="${dbUrl}" target="_blank" rel="noopener noreferrer" class="h-addr-label">${h.label}</a><span class="h-badge ${bCls}">${h.type}</span></div><div class="h-addr-line2"><span class="h-addr-hex-sm">${shortA}</span>${copyButton}${dbIcon}</div></div></td>`;
        } else {
            addrTd=`<td class="h-td h-td-addr"${dataLabelAttr('Address')}><div class="h-addr-two-line"><div class="h-addr-line1"><a href="${dbUrl}" target="_blank" rel="noopener noreferrer" class="h-addr-hex">${shortA}</a>${copyButton}${dbIcon}</div></div></div></td>`;
        }
        let chainCells='';
        visChains.forEach(k=>{
            const bal=h.balances[k]||0;
            if (compactMode && bal <= 0) return;
            if(bal>0){
                const expUrl=CHAIN_EXPLORERS[k]+h.address;
                const chainUsd=bal*price;
                chainCells+=`<td class="h-td h-td-right"${dataLabelAttr(DATA.chains[k].short)}><a href="${expUrl}" target="_blank" rel="noopener noreferrer" style="color:${CHAIN_COLORS[k]};text-decoration:none;font-size:11px" title="${bal.toLocaleString('en-US')} ZRO on ${DATA.chains[k].name}">${fmt(bal)}</a><div class="h-usd-sub">${fmtUSD(chainUsd)}</div></td>`;
            } else {
                chainCells+=`<td class="h-td h-td-right"${dataLabelAttr(DATA.chains[k].short)}><span class="h-dash">—</span></td>`;
            }
        });
        const balCell=`<td class="h-td h-td-right"${dataLabelAttr('Balance')} title="${dispBal.toLocaleString('en-US')} ZRO"><span class="h-bal-total">${fmt(dispBal)}</span><div class="h-usd-sub">${fmtUSD(usdVal)}</div></td>`;
        html+=`<tr class="h-row h-row-has-detail" ${clickableRowAttrs(dbUrl, 'Open wallet details')}${registerDetailPayload(detailKey, detailPayload)}><td class="h-td h-td-rank"${dataLabelAttr('Rank')}>${start+idx+1}</td>${addrTd}${chainCells}${balCell}</tr>`;
    });
    if (!compactMode && items.length) {
        for(let i=page.length;i<HOLDERS_PER_PAGE;i++) html+=`<tr class="h-row-empty">${('<td class="h-td">&nbsp;</td>').repeat(colCount)}</tr>`;
    }
    document.getElementById('holders-tbody').innerHTML=html;
    setText('holders-count-header', `${DATA.top_holders.length.toLocaleString()} tracked`);
    setText('holders-count-toolbar', `${items.length.toLocaleString()} visible`);
    // Pagination — always visible (Dolomite constant pager)
    document.getElementById('holders-pager').innerHTML=
        pageButtonHTML('holders', -999, '«', holdersPage<=1)+
        pageButtonHTML('holders', -1, '‹', holdersPage<=1)+
        `<span class="pg-info">${holdersPage} / ${totalPages.toLocaleString()}</span>`+
        pageButtonHTML('holders', 1, '›', holdersPage>=totalPages)+
        pageButtonHTML('holders', 999, '»', holdersPage>=totalPages);
    updateUrlState();
}
function sortHolders(k) {
    if(k==='rank') return;
    if(holdersSortKey===k) holdersSortDir=holdersSortDir==='asc'?'desc':'asc';
    else {holdersSortKey=k;holdersSortDir=(k==='address'?'asc':'desc');}
    holdersPage=1;
    requestHistoryMode('push');
    renderHolders();
}
function goHoldersPage(delta) {
    const totalPages = Math.max(1, Math.ceil(getFilteredHolders().length / HOLDERS_PER_PAGE));
    holdersPage = applyPageDelta(holdersPage, totalPages, delta);
    requestHistoryMode('push');
    renderHolders();
}
function filterHolders() { holdersSearchQuery=document.getElementById('holders-search').value.trim();holdersPage=1;renderHolders(); }
// ── Fresh Wallets ──
let freshPage=1, freshSearchQuery='', freshSortKey='signal', freshSortDir='desc', freshFilterMode='all';
const FRESH_PER_PAGE=15;
function getFreshWalletUniverse() {
    return DATA.top_holders.filter(h => (h.type === 'FRESH' || h.fresh === true) && getHolderTotalBalance(h) >= 10000);
}
function matchesFreshFilter(holder) {
    if (freshFilterMode === 'accumulators') {
        return ['fresh_accumulator', 'fresh_whale_accumulator'].includes(holder?.fresh_signal);
    }
    if (freshFilterMode === 'whales') {
        return holder?.fresh_signal === 'fresh_whale_accumulator';
    }
    return true;
}
function getFreshWallets(includeSearch=true) {
    let items = getFreshWalletUniverse();
    items = items.filter(matchesFreshFilter);
    if(includeSearch && freshSearchQuery) {
        const q = freshSearchQuery.toLowerCase();
        items = items.filter(h => h.address.toLowerCase().includes(q) || (h.label||'').toLowerCase().includes(q));
    }
    items.sort((a,b) => {
        let aVal = 0, bVal = 0;
        if (freshSortKey === 'signal') {
            return compareFreshSignal(a, b, freshSortDir);
        } else if (freshSortKey === 'date') {
            aVal = getFreshCreatedDisplay(a).value || 0;
            bVal = getFreshCreatedDisplay(b).value || 0;
            return freshSortDir === 'asc' ? aVal - bVal : bVal - aVal;
        } else if (freshSortKey === 'flow') {
            aVal = a.last_flow || 0;
            bVal = b.last_flow || 0;
            return compareSnapshotValues(aVal, bVal, freshSortDir);
        } else {
            aVal = getHolderTotalBalance(a);
            bVal = getHolderTotalBalance(b);
        }
        return freshSortDir === 'asc' ? aVal - bVal : bVal - aVal;
    });
    return items;
}
function toggleFreshSort(key) {
    if (freshSortKey === key) freshSortDir = freshSortDir === 'desc' ? 'asc' : 'desc';
    else {
        freshSortKey = key;
        freshSortDir = 'desc';
    }
    freshPage = 1;
    requestHistoryMode('push');
    renderFreshWallets();
}
function setFreshFilter(mode) {
    const nextMode = ['all', 'accumulators', 'whales'].includes(mode) ? mode : 'all';
    if (freshFilterMode === nextMode) return;
    freshFilterMode = nextMode;
    freshPage = 1;
    requestHistoryMode('push');
    renderFreshWallets();
}
function renderFreshWallets() {
    let freshHolders = getFreshWallets();
    setActiveDataChoice('fresh-filter-pills', 'freshFilter', freshFilterMode);
    // Update sort indicators
    const signalTh = document.getElementById('fresh-sort-signal');
    const dateTh = document.getElementById('fresh-sort-date');
    const flowTh = document.getElementById('fresh-sort-flow');
    const balTh = document.getElementById('fresh-sort-balance');
    if(signalTh) signalTh.textContent = sortLabel('Signal', freshSortKey, 'signal', freshSortDir);
    if(dateTh) dateTh.textContent = sortLabel('Created', freshSortKey, 'date', freshSortDir);
    if(flowTh) flowTh.textContent = sortLabel('Last Flow', freshSortKey, 'flow', freshSortDir);
    if(balTh) balTh.textContent = sortLabel('Balance', freshSortKey, 'balance', freshSortDir);
    const freshUniverse = getFreshWalletUniverse();
    const allFresh = getFreshWallets(false);
    const price = DATA.meta?.price_usd || 0;
    const total = freshHolders.length;
    const totalPages = Math.max(1, Math.ceil(total / FRESH_PER_PAGE));
    freshPage = Math.min(freshPage, totalPages);
    const start = (freshPage - 1) * FRESH_PER_PAGE;
    const pageItems = freshHolders.slice(start, start + FRESH_PER_PAGE);
    let html = '';
    pageItems.forEach((h, i) => {
        const bal = getHolderTotalBalance(h);
        const usdVal = price ? fmtUSD(bal * price) : '';
        const shortA = h.address.slice(0,6)+'…'+h.address.slice(-4);
        const dbUrl = `https://debank.com/profile/${h.address}`;
        const mainChain = getMainChain(h.address);
        const explorerUrl = (EXPLORER_MAP[mainChain] || EXPLORER_MAP.ethereum) + h.address;
        const dbIcon = debankIconHTML(dbUrl);
        const explorerIcon = explorerIconHTML(explorerUrl, `View ${shortA} on ${DATA.chains?.[mainChain]?.name || 'explorer'}`);
        const label = h.label || 'Fresh Wallet';
        const rank = start+i+1;
        const rankCls = rank <= 3 ? 'rank-badge top-3' : 'rank-badge';
        const fundedBy = h.funded_by ? `<span class="h-badge h-badge-funded" title="Funded by ${h.funded_by}">via ${h.funded_by}</span>` : '';
        const signalTooltipParts = [];
        if (h.fresh_signal_label && h.fresh_signal_label !== 'Fresh wallet') {
            signalTooltipParts.push(h.fresh_signal_label);
            if (Number(h.fresh_retention_ratio || 0) > 0) signalTooltipParts.push(`retention ${Math.round(Number(h.fresh_retention_ratio || 0) * 100)}%`);
            if (Number(h.fresh_net_accumulation || 0) > 0) signalTooltipParts.push(`net +${fmt(Number(h.fresh_net_accumulation || 0))} ZRO`);
        }
        const signalTitle = signalTooltipParts.join(' · ');
        const signalLabel = h.fresh_signal_label && h.fresh_signal_label !== 'Fresh wallet'
            ? `<span class="h-badge h-badge-fresh-signal" title="${escapeAttr(signalTitle)}">${h.fresh_signal_label}</span>`
            : '';
        const profileTooltipParts = [];
        if (h.fresh_profile_label && h.fresh_profile_label !== 'Independent') {
            profileTooltipParts.push(h.fresh_profile_label);
            if (Number(h.fresh_cex_in_count || 0) > 0) profileTooltipParts.push(`from CEX: ${fmt(Number(h.fresh_cex_in_count || 0))}`);
            if (Number(h.fresh_cex_out_count || 0) > 0) profileTooltipParts.push(`to CEX: ${fmt(Number(h.fresh_cex_out_count || 0))}`);
        }
        const profileTitle = profileTooltipParts.join(' · ');
        const profileLabel = h.fresh_profile_label && h.fresh_profile_label !== 'Independent'
            ? `<span class="h-badge h-badge-fresh-profile" title="${escapeAttr(profileTitle)}">${h.fresh_profile_label}</span>`
            : '';
        const signalDisplay = getFreshSignalDisplay(h);
        const createdDisplay = getFreshCreatedDisplay(h);
        const createdDate = createdDisplay.label;
        const createdAge = createdDisplay.sublabel;
        const addrTd = `<div class="h-addr-two-line fresh-address-cell"><div class="h-addr-line1"><a href="${explorerUrl}" target="_blank" rel="noopener noreferrer" class="h-addr-label">${label}</a><span class="h-badge h-badge-fresh">FRESH</span>${signalLabel}${profileLabel}${fundedBy}</div><div class="h-addr-line2"><span class="h-addr-hex-sm">${shortA}</span>${copyButtonHTML(h.address)}${dbIcon}${explorerIcon}</div></div>`;
        const lastFlowDate = h.last_flow ? new Date(h.last_flow * 1000).toLocaleDateString('en-GB', {day:'numeric',month:'short'}) : '';
        const lastFlowAge = formatDaysAgoFromSnapshot(h.last_flow);
        const lfAmt = h.last_flow_amount || 0;
        const lfSign = lfAmt >= 0 ? '+' : '';
        const lfColor = lfAmt >= 0 ? 'color:#4ade80' : 'color:#f87171';
        const lastFlowLine1 = lfAmt ? `<span style="${lfColor}">${lfSign}${fmt(lfAmt)} ZRO</span> · ${lastFlowDate}` : '—';
        const rowClass = [
            'fresh-table-row',
            h.fresh_signal === 'fresh_whale_accumulator' ? 'fresh-row-whale' : '',
            h.fresh_signal === 'fresh_accumulator' ? 'fresh-row-accumulator' : '',
            h.fresh_signal === 'accumulator_watchlist' ? 'fresh-row-watchlist' : '',
            h.fresh_signal === 'high_turnover' ? 'fresh-row-turnover' : '',
        ].filter(Boolean).join(' ');
        const freshDetailKey = `fresh:${h.address}`;
        const freshDetailPayload = buildWalletDrawerPayload(h, {
            eyebrow: `Fresh wallet #${rank}`,
            title: h.label || 'Fresh Wallet',
            metrics: [
                { value: `${fmt(bal)} ZRO`, label: 'Current balance', sub: price ? fmtUSD(bal * price) : 'Live price unavailable' },
                { value: signalDisplay.label, label: 'Signal', sub: signalDisplay.detail || 'Fresh wallet profile' },
                { value: createdDate, label: 'Created', sub: createdAge || 'Indexed age' },
            ],
        });
        html += `<tr class="${rowClass}" role="button" tabindex="0" aria-label="Open fresh wallet details"${registerDetailPayload(freshDetailKey, freshDetailPayload)}>
            <td${dataLabelAttr('Rank')}><span class="${rankCls}">${rank}</span></td>
            <td${dataLabelAttr('Address')}>${addrTd}</td>
            <td${dataLabelAttr('Signal')}><div class="fresh-signal-main${signalDisplay.emphasis === 'neutral' ? ' signal-neutral' : ''}">${signalDisplay.label}</div><div class="fresh-signal-meta">${signalDisplay.detail}</div></td>
            <td class="right"${dataLabelAttr('Created')}><div class="fresh-date${createdDisplay.estimated ? ' fresh-date-estimated' : ''}">${createdDate}</div><div class="val-muted">${createdAge}</div></td>
            <td class="right"${dataLabelAttr('Last Flow')}><div class="fresh-date">${lastFlowLine1}</div><div class="val-muted">${lastFlowAge}</div></td>
            <td class="right"${dataLabelAttr('Balance')}><div class="bal-main">${fmt(bal)}<span class="bal-unit">ZRO</span></div>${usdVal?`<div class="h-usd-sub">${usdVal}</div>`:''}</td>
        </tr>`;
    });
    // Pad empty rows to keep constant height
    const emptyRows = FRESH_PER_PAGE - pageItems.length;
    for(let e=0;e<emptyRows;e++) html += '<tr class="h-row-empty"><td colspan="6"></td></tr>';
    if(!total && !freshSearchQuery) html = '<tr><td colspan="6"><div class="table-empty-state"><div class="empty-icon">🌱</div><div class="empty-text">No fresh wallets tracked</div></div></td></tr>';
    if(!total && freshSearchQuery) html = '<tr><td colspan="6"><div class="table-empty-state"><div class="empty-icon">🔍</div><div class="empty-text">No results for "'+freshSearchQuery+'"</div></div></td></tr>';
    document.getElementById('fresh-tbody').innerHTML = html;
    const totalBal = allFresh.reduce((sum, holder) => sum + getHolderTotalBalance(holder), 0);
    const totalUsd = price ? fmtUSD(totalBal * price) : '—';
    const circSupply = DATA.meta?.circulating_supply || 252160000;
    const pctCirc = (totalBal / circSupply * 100).toFixed(2);
    const missingCreated = DATA.meta?.integrity?.fresh_wallets_missing_created || 0;
    const missingLastFlow = DATA.meta?.integrity?.fresh_wallets_missing_last_flow || 0;
    const accumulatorCount = freshUniverse.filter(holder => ['fresh_accumulator', 'fresh_whale_accumulator'].includes(holder.fresh_signal)).length;
    const whaleAccumulatorCount = freshUniverse.filter(holder => holder.fresh_signal === 'fresh_whale_accumulator').length;
    const freshIntegrityNote = (missingCreated || missingLastFlow)
        ? ` · snapshot metadata missing for ${missingCreated} created dates and ${missingLastFlow} last-flow timestamps`
        : '';
    const accumulatorNote = accumulatorCount ? ` · ${accumulatorCount} strong accumulator signals` : '';
    const filterNote = freshFilterMode === 'all'
        ? 'New wallets accumulating ZRO'
        : freshFilterMode === 'accumulators'
            ? 'Fresh accumulators with stronger conviction'
            : 'Fresh whale accumulators only';
    document.getElementById('fresh-sub').textContent = `${filterNote}${accumulatorNote}${freshIntegrityNote}`;
    const statsEl = document.getElementById('fresh-stats');
    const primaryStatLabel = freshFilterMode === 'all'
        ? 'Fresh Wallets'
        : freshFilterMode === 'accumulators'
            ? 'Accumulators'
            : 'Whale Accumulators';
    const whaleStatActive = freshFilterMode === 'whales';
    const whaleStatAttrs = `class="fresh-stat fresh-stat-clickable${whaleStatActive ? ' is-active' : ''}" data-fresh-filter-target="whales" role="button" tabindex="0" aria-pressed="${whaleStatActive ? 'true' : 'false'}"`;
    if(statsEl) statsEl.innerHTML = `
        <div class="fresh-stat"><div class="fresh-stat-val accent-white">${allFresh.length}</div><div class="fresh-stat-lbl">${primaryStatLabel}</div></div>
        <div class="fresh-stat"><div class="fresh-stat-val">${fmt(totalBal)} ZRO</div><div class="fresh-stat-lbl">Total Accumulated</div></div>
        <div class="fresh-stat"><div class="fresh-stat-val accent-cyan">${totalUsd}</div><div class="fresh-stat-lbl">USD Value</div></div>
        <div ${whaleStatAttrs}><div class="fresh-stat-val accent-amber">${whaleAccumulatorCount}</div><div class="fresh-stat-lbl">Whale Accumulators</div></div>
        <div class="fresh-stat"><div class="fresh-stat-val">${pctCirc}%</div><div class="fresh-stat-lbl">of Circulating Supply</div></div>
    `;
    const countEl = document.getElementById('fresh-count');
    if(countEl) countEl.textContent = freshSearchQuery ? `${total} matching` : `${total} ${FRESH_FILTER_LABELS[freshFilterMode] || 'fresh wallets'}`;
    // Pager — always visible (constant pager pattern)
    const pagerEl = document.getElementById('fresh-pager');
    if(pagerEl) {
        pagerEl.innerHTML = `
            ${pageButtonHTML('fresh', -999, '&laquo;', freshPage<=1)}
            ${pageButtonHTML('fresh', -1, '&lsaquo;', freshPage<=1)}
            <span class="pg-info">${freshPage} / ${totalPages}</span>
            ${pageButtonHTML('fresh', 1, '&rsaquo;', freshPage>=totalPages)}
            ${pageButtonHTML('fresh', 999, '&raquo;', freshPage>=totalPages)}`;
    }
    updateUrlState();
}
function goFreshPage(delta) {
    const totalPages = Math.max(1, Math.ceil(getFreshWallets().length / FRESH_PER_PAGE));
    freshPage = applyPageDelta(freshPage, totalPages, delta);
    requestHistoryMode('push');
    renderFreshWallets();
}
function filterFresh() { freshSearchQuery=document.getElementById('fresh-search').value.trim();freshPage=1;renderFreshWallets(); }

// ── Coinbase Prime Investors ──
let cbPage=1, cbSearchQuery='', cbPeriodDays=0, cbSortKey='balance', cbSortDir='desc';
const CB_PER_PAGE=15;
function getCoinbasePrimeHolders(includeSearch=true) {
    const nowSec = getSnapshotReferenceSec();
    let items = DATA.top_holders.filter(h => h.label === 'Coinbase Prime Investor');
    if(cbPeriodDays > 0) {
        const cutoff = nowSec - (cbPeriodDays * 86400);
        items = items.filter(h => {
            const ts = h.cb_first_funded || h.cb_last_funded || 0;
            return ts >= cutoff;
        });
    }
    if(includeSearch && cbSearchQuery) {
        const q = cbSearchQuery.toLowerCase();
        items = items.filter(h => h.address.toLowerCase().includes(q) || (h.label||'').toLowerCase().includes(q));
    }
    items.sort((a,b) => {
        let aVal = 0, bVal = 0;
        if (cbSortKey === 'date') {
            aVal = a.cb_first_funded || 0;
            bVal = b.cb_first_funded || 0;
            return compareSnapshotValues(aVal, bVal, cbSortDir);
        } else if (cbSortKey === 'flow') {
            aVal = a.cb_last_funded || 0;
            bVal = b.cb_last_funded || 0;
            return compareSnapshotValues(aVal, bVal, cbSortDir);
        } else {
            aVal = getHolderTotalBalance(a);
            bVal = getHolderTotalBalance(b);
        }
        return cbSortDir === 'asc' ? aVal - bVal : bVal - aVal;
    });
    return items;
}
function toggleCbSort(key) {
    if (cbSortKey === key) cbSortDir = cbSortDir === 'desc' ? 'asc' : 'desc';
    else {
        cbSortKey = key;
        cbSortDir = 'desc';
    }
    cbPage = 1;
    requestHistoryMode('push');
    renderCoinbasePrime();
}
function renderCoinbasePrime() {
    let cbHolders = getCoinbasePrimeHolders();
    // Update sort indicators
    const dateTh = document.getElementById('cb-sort-date');
    const flowTh = document.getElementById('cb-sort-flow');
    const balTh = document.getElementById('cb-sort-balance');
    if(dateTh) dateTh.textContent = sortLabel('First Funded', cbSortKey, 'date', cbSortDir);
    if(flowTh) flowTh.textContent = sortLabel('Last Flow', cbSortKey, 'flow', cbSortDir);
    if(balTh) balTh.textContent = sortLabel('Balance', cbSortKey, 'balance', cbSortDir);
    const allCb = getCoinbasePrimeHolders(false);
    const price = DATA.meta?.price_usd || 0;
    const total = cbHolders.length;
    const totalPages = Math.max(1, Math.ceil(total / CB_PER_PAGE));
    cbPage = Math.min(cbPage, totalPages);
    const start = (cbPage - 1) * CB_PER_PAGE;
    const pageItems = cbHolders.slice(start, start + CB_PER_PAGE);
    let html = '';
    pageItems.forEach((h, i) => {
        const bal = getHolderTotalBalance(h);
        const usdVal = price ? fmtUSD(bal * price) : '';
        const shortA = h.address.slice(0,6)+'…'+h.address.slice(-4);
        const dbUrl = `https://debank.com/profile/${h.address}`;
        const explorerUrl = `https://etherscan.io/address/${h.address}`;
        const dbIcon = debankIconHTML(dbUrl);
        const explorerIcon = explorerIconHTML(explorerUrl, `View ${shortA} on Etherscan`);
        const rank = start+i+1;
        const rankCls = rank <= 3 ? 'rank-badge top-3' : 'rank-badge';
        const fundedDate = h.cb_first_funded ? new Date(h.cb_first_funded * 1000).toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'}) : '—';
        const fundedAge = formatDaysAgoFromSnapshot(h.cb_first_funded);
        const addrTd = `<div class="h-addr-two-line"><div class="h-addr-line1"><a href="${explorerUrl}" target="_blank" rel="noopener noreferrer" class="h-addr-label">Coinbase Prime</a><span class="h-badge h-badge-inst">INST</span></div><div class="h-addr-line2"><span class="h-addr-hex-sm">${shortA}</span>${copyButtonHTML(h.address)}${dbIcon}${explorerIcon}</div></div>`;
        const lastFundedDate = h.cb_last_funded ? new Date(h.cb_last_funded * 1000).toLocaleDateString('en-GB', {day:'numeric',month:'short'}) : '';
        const lastFundedAge = formatDaysAgoFromSnapshot(h.cb_last_funded);
        const lastFlowAmt = h.cb_last_flow_amount || h.cb_total_received;
        const cbTotalRcv = lastFlowAmt ? `<span style="color:#4ade80">+${fmt(lastFlowAmt)} ZRO</span> · ${lastFundedDate}` : '—';
        const cbDetailKey = `cb:${h.address}`;
        const cbDetailPayload = buildWalletDrawerPayload(h, {
            eyebrow: `Coinbase Prime wallet #${rank}`,
            title: 'Coinbase Prime',
            metrics: [
                { value: `${fmt(bal)} ZRO`, label: 'Custodied balance', sub: price ? fmtUSD(bal * price) : 'Live price unavailable' },
                { value: fundedDate, label: 'First funded', sub: fundedAge || 'Indexed age' },
                { value: cbTotalRcv.replace(/<[^>]+>/g, ''), label: 'Last flow', sub: lastFundedAge || 'Snapshot-relative' },
            ],
            badges: [{ label: 'INST', tone: 'inst' }],
        });
        html += `<tr class="cb-table-row${rank <= 3 ? ' cb-top-row' : ''}" role="button" tabindex="0" aria-label="Open Coinbase Prime wallet details"${registerDetailPayload(cbDetailKey, cbDetailPayload)}>
            <td${dataLabelAttr('Rank')}><span class="${rankCls}">${rank}</span></td>
            <td${dataLabelAttr('Address')}>${addrTd}</td>
            <td class="right"${dataLabelAttr('First Funded')}><div class="fresh-date">${fundedDate}</div><div class="val-muted">${fundedAge}</div></td>
            <td class="right"${dataLabelAttr('Last Flow')}><div class="fresh-date">${cbTotalRcv}</div><div class="val-muted">${lastFundedAge}</div></td>
            <td class="right"${dataLabelAttr('Balance')}><div class="bal-main">${fmt(bal)}<span class="bal-unit">ZRO</span></div>${usdVal?`<div class="h-usd-sub">${usdVal}</div>`:''}</td>
        </tr>`;
    });
    const emptyRows = CB_PER_PAGE - pageItems.length;
    for(let e=0;e<emptyRows;e++) html += '<tr class="h-row-empty"><td colspan="5"></td></tr>';
    if(!total && !cbSearchQuery) html = '<tr><td colspan="5"><div class="table-empty-state"><div class="empty-icon">🏦</div><div class="empty-text">No Coinbase Prime wallets in this period</div></div></td></tr>';
    if(!total && cbSearchQuery) html = '<tr><td colspan="5"><div class="table-empty-state"><div class="empty-icon">🔍</div><div class="empty-text">No results for "'+cbSearchQuery+'"</div></div></td></tr>';
    document.getElementById('cb-tbody').innerHTML = html;
    const totalBal = allCb.reduce((sum, holder) => sum + getHolderTotalBalance(holder), 0);
    const totalUsd = price ? fmtUSD(totalBal * price) : '—';
    const circSupply = DATA.meta?.circulating_supply || 252160000;
    const pctCirc = (totalBal / circSupply * 100).toFixed(2);
    const periodLabel = cbPeriodDays > 0 ? ` (last ${cbPeriodDays}d)` : '';
    document.getElementById('cb-sub').textContent = `${allCb.length} institutional custody wallets${periodLabel}`;
    const statsEl = document.getElementById('cb-stats');
    if(statsEl) statsEl.innerHTML = `
        <div class="fresh-stat"><div class="fresh-stat-val cb-stat-val">${allCb.length}</div><div class="fresh-stat-lbl">Wallets${periodLabel}</div></div>
        <div class="fresh-stat"><div class="fresh-stat-val">${fmt(totalBal)} ZRO</div><div class="fresh-stat-lbl">Total Accumulated</div></div>
        <div class="fresh-stat"><div class="fresh-stat-val cb-stat-val">${totalUsd}</div><div class="fresh-stat-lbl">USD Value</div></div>
        <div class="fresh-stat"><div class="fresh-stat-val">${pctCirc}%</div><div class="fresh-stat-lbl">of Circulating Supply</div></div>
    `;
    const countEl = document.getElementById('cb-count');
    if(countEl) countEl.textContent = cbSearchQuery ? `${total} matching` : `${total} wallets`;
    const pagerEl = document.getElementById('cb-pager');
    if(pagerEl) {
        pagerEl.innerHTML = `
            ${pageButtonHTML('cb', -999, '&laquo;', cbPage<=1)}
            ${pageButtonHTML('cb', -1, '&lsaquo;', cbPage<=1)}
            <span class="pg-info">${cbPage} / ${totalPages}</span>
            ${pageButtonHTML('cb', 1, '&rsaquo;', cbPage>=totalPages)}
            ${pageButtonHTML('cb', 999, '&raquo;', cbPage>=totalPages)}`;
    }
    updateUrlState();
}
function goCbPage(delta) {
    const totalPages = Math.max(1, Math.ceil(getCoinbasePrimeHolders().length / CB_PER_PAGE));
    cbPage = applyPageDelta(cbPage, totalPages, delta);
    requestHistoryMode('push');
    renderCoinbasePrime();
}
function filterCb() { cbSearchQuery=document.getElementById('cb-search').value.trim();cbPage=1;renderCoinbasePrime(); }
function filterCbt() { cbtSearchQuery=document.getElementById('cbt-search').value.trim();cbtPage=1;renderCbTransfers(); }
function initCbPeriodPills() {
    document.getElementById('cb-period-pills').querySelectorAll('button').forEach(b => {
        b.addEventListener('click', () => {
            document.querySelector('#cb-period-pills .active')?.classList.remove('active');
            b.classList.add('active');
            cbPeriodDays = parseInt(b.dataset.period);
            cbPage = 1;
            requestHistoryMode('push');
            renderCoinbasePrime();
        });
    });
}

// ── Coinbase Prime Transfers ──
let cbtPage=1, cbtTypeFilter='ALL', cbtPeriodDays=0, cbtSearchQuery='', cbtSortKey='date', cbtSortDir='desc';
const CBT_PER_PAGE=20;
const CBT_TYPE_COLORS = {BUY:'#00D395', SELL:'#FF4444', TRANSFER:'#0052FF', OUTFLOW:'#FFA500', INFLOW:'#00D395'};
const CBT_TYPE_ICONS = {BUY:'🟢', SELL:'🔴', TRANSFER:'🔄', OUTFLOW:'🟠', INFLOW:'🟢'};

function cbtAddrCell(addr, label) {
    const short = addr.slice(0,6)+'…'+addr.slice(-4);
    const dbUrl = `https://debank.com/profile/${addr}`;
    const explorerUrl = `https://etherscan.io/address/${addr}`;
    return `<div class="cbt-addr-cell">
        <div class="cbt-addr-main">
            <a href="${explorerUrl}" target="_blank" rel="noopener noreferrer" class="cbt-addr-name" title="${addr}">${label||short}</a>
            <button type="button" class="addr-icon-btn" data-copy="${escapeAttr(addr)}" title="Copy address" aria-label="Copy address"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
            <a href="${dbUrl}" target="_blank" rel="noopener noreferrer" class="addr-icon-btn" title="Open in DeBank" aria-label="Open in DeBank"><img src="https://debank.com/favicon.ico" width="12" height="12" alt="" aria-hidden="true" class="h-debank-favicon" style="border-radius:2px"></a>
        </div>
        ${label ? `<div class="cbt-addr-hex">${short}</div>` : ''}
    </div>`;
}

function renderCbtDateCell(timestamp) {
    const date = new Date(timestamp * 1000);
    const dayLabel = date.toLocaleDateString('en-GB', { day:'numeric', month:'short' });
    const timeLabel = date.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', hour12:false });
    const ageLabel = formatDaysAgoFromSnapshot(timestamp);
    return `<div class="cbt-date-cell">
        <div class="cbt-date-main">${dayLabel}</div>
        <div class="cbt-date-sub">${timeLabel}${ageLabel ? ` · ${ageLabel}` : ''}</div>
    </div>`;
}

// ─── Fixed column config (user-set widths, locked) ───
const CBT_COLUMNS = [
    { id:'date', header:'Date', mobileLabel:'Date', width:126, align:'left', sortable:'date', render: (t) => renderCbtDateCell(t.timestamp) },
    { id:'from', header:'From', mobileLabel:'From', width:264, align:'left', render: (t) => {
        const txShort = t.hash ? t.hash.slice(0,10)+'…' : '';
        return `<div class="cbt-from-cell">
            ${cbtAddrCell(t.from, t.from_label)}
            <div class="cbt-tx-meta">
                <a href="https://etherscan.io/tx/${t.hash}" target="_blank" rel="noopener" class="cbt-tx-link" title="${t.hash}">Tx ${txShort}</a>
            </div>
        </div>`;
    }},
    { id:'to', header:'To', mobileLabel:'To', width:264, align:'left', render: (t) => cbtAddrCell(t.to, t.to_label) },
    { id:'type', header:'Type', mobileLabel:'Flow Type', width:132, align:'left', render: (t) => `<span style="color:${CBT_TYPE_COLORS[t.type]||'var(--text-primary)'};font-weight:600;font-size:12px">${CBT_TYPE_ICONS[t.type]||''} ${t.type}</span>` },
    { id:'amount', header:'Amount', mobileLabel:'Amount', width:164, align:'right', sortable:'amount', render: (t,p) => { const out=t.type==='SELL'||t.type==='OUTFLOW'; const c=out?'#FF4444':'#00D395'; const s=out?'-':'+'; const u=p?`<div class="h-usd-sub">${fmtUSD(t.value*p)}</div>`:''; return `<div style="color:${c};font-weight:600;font-variant-numeric:tabular-nums">${s}${fmt(t.value)} ZRO</div>${u}`; }},
];
function toggleCbtSort(key) {
    if (cbtSortKey === key) cbtSortDir = cbtSortDir === 'desc' ? 'asc' : 'desc';
    else {
        cbtSortKey = key;
        cbtSortDir = 'desc';
    }
    cbtPage = 1;
    requestHistoryMode('push');
    renderCbTransfers();
}
function setCbtTypeTriggerLabel() {
    const trigger = document.getElementById('cbt-type-trigger');
    if (!trigger) return;
    const icon = CBT_TYPE_ICONS[cbtTypeFilter] || '';
    trigger.textContent = cbtTypeFilter === 'ALL' ? 'ALL ▾' : `${icon} ${cbtTypeFilter} ▾`;
}
function toggleCbtTypeDropdown() {
    const menu = document.getElementById('cbt-type-menu');
    const trigger = document.getElementById('cbt-type-trigger');
    if(!menu || !trigger) return;
    const isOpen = !menu.classList.contains('open');
    closeFloatingMenus(isOpen ? 'cbt' : null);
    menu.classList.toggle('open', isOpen);
    trigger.classList.toggle('active', isOpen);
    trigger.setAttribute('aria-expanded', String(isOpen));
}
function setCbtType(type) {
    cbtTypeFilter = type;
    setCbtTypeTriggerLabel();
    closeCbtTypeDropdown();
    cbtPage = 1;
    requestHistoryMode('push');
    renderCbTransfers();
}
function getFilteredCbtTransfers() {
    const txs = DATA.cb_prime_transfers || [];
    const nowSec = getSnapshotReferenceSec();
    let filtered = cbtTypeFilter === 'ALL'
        ? txs.filter(t => t.type !== 'INTERNAL' && t.value >= 10000)
        : txs.filter(t => t.type === cbtTypeFilter && t.value >= 10000);
    if(cbtPeriodDays > 0) {
        const cutoff = nowSec - (cbtPeriodDays * 86400);
        filtered = filtered.filter(t => t.timestamp >= cutoff);
    }
    if(cbtSearchQuery) {
        const q = cbtSearchQuery.toLowerCase();
        filtered = filtered.filter(t =>
            t.from.toLowerCase().includes(q) ||
            t.to.toLowerCase().includes(q) ||
            (t.from_label||'').toLowerCase().includes(q) ||
            (t.to_label||'').toLowerCase().includes(q)
        );
    }
    filtered.sort((a, b) => {
        let diff = 0;
        if (cbtSortKey === 'amount') diff = Number(a.value || 0) - Number(b.value || 0);
        else diff = Number(a.timestamp || 0) - Number(b.timestamp || 0);
        if (diff !== 0) return cbtSortDir === 'asc' ? diff : -diff;
        if (cbtSortKey === 'amount') return Number(b.timestamp || 0) - Number(a.timestamp || 0);
        return Number(b.value || 0) - Number(a.value || 0);
    });
    return filtered;
}

function renderCbTransfers() {
    const price = DATA.meta?.price_usd || 0;
    const filtered = getFilteredCbtTransfers();
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / CBT_PER_PAGE));
    cbtPage = Math.min(cbtPage, totalPages);
    const start = (cbtPage - 1) * CBT_PER_PAGE;
    const pageItems = filtered.slice(start, start + CBT_PER_PAGE);
    // Stats
    const totalIn = filtered.filter(t => t.type==='BUY'||t.type==='INFLOW').reduce((s,t)=>s+t.value,0);
    const totalOut = filtered.filter(t => t.type==='SELL'||t.type==='OUTFLOW').reduce((s,t)=>s+t.value,0);
    const net = totalIn - totalOut;
    const periodLabel = cbtPeriodDays > 0 ? `last ${cbtPeriodDays}d` : 'all time';
    const statsEl = document.getElementById('cbt-stats');
    if(statsEl) statsEl.innerHTML = `
        <div class="fresh-stat"><div class="fresh-stat-val" style="color:#00D395">+${fmt(totalIn)}</div><div class="fresh-stat-lbl">Total Inflow</div></div>
        <div class="fresh-stat"><div class="fresh-stat-val" style="color:#FF4444">-${fmt(totalOut)}</div><div class="fresh-stat-lbl">Total Outflow</div></div>
        <div class="fresh-stat"><div class="fresh-stat-val" style="color:${net>=0?'#00D395':'#FF4444'}">${net>=0?'+':''}${fmt(net)}</div><div class="fresh-stat-lbl">Net Flow</div></div>
        <div class="fresh-stat"><div class="fresh-stat-val cb-stat-val">${total}</div><div class="fresh-stat-lbl">Transactions (${periodLabel})</div></div>
    `;
    const subEl = document.getElementById('cbt-sub');
    if(subEl) subEl.textContent = `${total} transfers (${periodLabel})`;
    // Build table
    const cols = CBT_COLUMNS;
    const colCount = cols.length;
    const tableEl = document.getElementById('cbt-table');
    tableEl.className = 'data-table table-mobile-cards table-mobile-cbt';
    tableEl.innerHTML = '';
    const cg = document.createElement('colgroup');
    cols.forEach(c => {
        const col = document.createElement('col');
        col.style.width = c.width + 'px';
        col.className = `cbt-col-${c.id}`;
        cg.appendChild(col);
    });
    tableEl.appendChild(cg);
    // thead
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    cols.forEach(c => {
        const th = document.createElement('th');
        th.classList.add(`cbt-col-${c.id}`);
        if(c.align === 'right') th.classList.add('right');
        if(c.sortable) {
            th.classList.add('sortable');
            const active = cbtSortKey === c.sortable;
            th.setAttribute('aria-sort', active ? (cbtSortDir === 'desc' ? 'descending' : 'ascending') : 'none');
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `table-sort-btn${active ? ' active' : ''}`;
            button.innerHTML = `${c.header}<span class="sort-arrow${active ? ' active' : ''}">${active ? (cbtSortDir === 'desc' ? '▼' : '▲') : '⇅'}</span>`;
            button.addEventListener('click', () => toggleCbtSort(c.sortable));
            th.appendChild(button);
        } else {
            th.textContent = c.header;
        }
        headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    tableEl.appendChild(thead);
    // tbody
    const tbody = document.createElement('tbody');
    pageItems.forEach(t => {
        const tr = document.createElement('tr');
        tr.className = `cbt-row cbt-row-${String(t.type || 'transfer').toLowerCase()}`;
        cols.forEach(c => {
            const td = document.createElement('td');
            td.classList.add(`cbt-col-${c.id}`);
            if(c.align === 'right') td.classList.add('right');
            td.setAttribute('data-label', c.mobileLabel || c.header.replace(/\s*⇅$/, ''));
            td.innerHTML = c.render(t, price);
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
    const emptyRows = CBT_PER_PAGE - pageItems.length;
    for(let e=0;e<emptyRows;e++) {
        const tr = document.createElement('tr'); tr.className = 'h-row-empty';
        const td = document.createElement('td'); td.colSpan = colCount;
        tr.appendChild(td); tbody.appendChild(tr);
    }
    if(!total) {
        tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center;color:var(--text-muted);padding:20px">No transfers in this period</td></tr>`;
    }
    tableEl.appendChild(tbody);
    // Pager
    const pagerEl = document.getElementById('cbt-pager');
    if(pagerEl) {
        pagerEl.innerHTML = `
            ${pageButtonHTML('cbt', -999, '&laquo;', cbtPage<=1)}
            ${pageButtonHTML('cbt', -1, '&lsaquo;', cbtPage<=1)}
            <span class="pg-info">${cbtPage} / ${totalPages}</span>
            ${pageButtonHTML('cbt', 1, '&rsaquo;', cbtPage>=totalPages)}
            ${pageButtonHTML('cbt', 999, '&raquo;', cbtPage>=totalPages)}`;
    }
    updateUrlState();
}

function goCbtPage(delta) {
    const totalPages = Math.max(1, Math.ceil(getFilteredCbtTransfers().length / CBT_PER_PAGE));
    cbtPage = applyPageDelta(cbtPage, totalPages, delta);
    requestHistoryMode('push');
    renderCbTransfers();
}
function initCbtPills() {
    document.getElementById('cbt-period-pills').querySelectorAll('button').forEach(b => {
        b.addEventListener('click', () => {
            document.querySelector('#cbt-period-pills .active')?.classList.remove('active');
            b.classList.add('active');
            cbtPeriodDays = parseInt(b.dataset.period);
            cbtPage = 1;
            requestHistoryMode('push');
            renderCbTransfers();
        });
    });
}


// ── New Institutional Wallets ──
function renderNewInstitutional() {
    const instHolders = DATA.top_holders.filter(h => h.type === 'NEW_INST' && getHolderTotalBalance(h) >= 10000).sort((a,b) => {
        const aTotal = getHolderTotalBalance(a);
        const bTotal = getHolderTotalBalance(b);
        return bTotal - aTotal;
    });
    const totalSupply = DATA.total_supply || 1000000000;
    const total = instHolders.length;
    let html = '';
    instHolders.forEach((h, i) => {
        const bal = getHolderTotalBalance(h);
        const pct = (bal / totalSupply * 100).toFixed(4);
        const short = h.address.slice(0,6)+'…'+h.address.slice(-4);
        const dbUrl = `https://debank.com/profile/${h.address}`;
        html += `<tr class="inst-row">
            <td class="rank-cell"${dataLabelAttr('Rank')}>${i+1}</td>
            <td${dataLabelAttr('Address')}><span class="h-addr-wrap"><a href="${dbUrl}" target="_blank" rel="noopener noreferrer" class="h-addr-hex">${short}</a><span class="h-badge h-badge-inst">NEW INST</span>${copyButtonHTML(h.address)}</span></td>
            <td class="right val-white" style="font-variant-numeric:tabular-nums"${dataLabelAttr('Balance')}>${fmt(bal)}</td>
            <td class="right val-muted" style="font-variant-numeric:tabular-nums"${dataLabelAttr('% of Supply')}>${pct}%</td>
            <td class="right" style="font-size:10px;color:var(--text-muted)"${dataLabelAttr('Deployer')}>BitGo / Gnosis Safe</td>
        </tr>`;
    });
    if(!total) html = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px">No new institutional wallets detected</td></tr>';
    const tbody = document.getElementById('inst-tbody');
    if(tbody) tbody.innerHTML = html;
    const sub = document.getElementById('inst-sub');
    if(sub) sub.textContent = `${total} wallets — BitGo / Gnosis Safe MultiSig created in last 30 days`;
    // Hide card if no institutional wallets
    const card = document.getElementById('inst-card');
    if(card) card.style.display = total ? '' : 'none';
}

let flowPageAcc=1, flowPageSell=1, flowChain='all', flowCohort='all', hideCex=true, flowSearchQuery='';
const CHAIN_ICONS_MAP={ethereum:'https://icons.llamao.fi/icons/chains/rsz_ethereum.jpg',arbitrum:'https://icons.llamao.fi/icons/chains/rsz_arbitrum.jpg',base:'https://icons.llamao.fi/icons/chains/rsz_base.jpg',bsc:'https://icons.llamao.fi/icons/chains/rsz_binance.jpg',optimism:'https://icons.llamao.fi/icons/chains/rsz_optimism.jpg',polygon:'https://icons.llamao.fi/icons/chains/rsz_polygon.jpg',avalanche:'https://icons.llamao.fi/icons/chains/rsz_avalanche.jpg'};

function getFlowItems(type){
    const flows=DATA.flows[currentPeriod]; if(!flows) return [];
    let items=(flows[type]||[]).slice();
    const q=flowSearchQuery.trim().toLowerCase();
    if(q) items=items.filter(f=>f.address.toLowerCase().includes(q)||(f.label&&f.label.toLowerCase().includes(q)));
    if(flowCohort!=='all') items=items.filter(item=>flowMatchesCohort(item, flowCohort));
    if(flowChain!=='all') items=items.filter(item=>flowMatchesChain(item, flowChain));
    if(hideCex) items=items.filter(item=>isMeaningfulFlowItem(item, type));
    else items=items.filter(item=>type==='accumulators' ? Number(item.net_flow||0) > 0 : Number(item.net_flow||0) < 0);
    items.sort((a, b) => {
        const scoreDiff = getFlowDisplayScore(b, type) - getFlowDisplayScore(a, type);
        if (scoreDiff !== 0) return scoreDiff;
        return Math.abs(Number(b.net_flow || 0)) - Math.abs(Number(a.net_flow || 0));
    });
    return items;
}
function toggleHideCex(){
    hideCex=!hideCex;
    const btn=document.getElementById('flow-hide-cex');
    btn.classList.toggle('active',hideCex);
    btn.setAttribute('aria-pressed', String(hideCex));
    flowPageAcc=1; flowPageSell=1;
    requestHistoryMode('push');
    renderFlows();
}

function renderFlows() {
    const flowBucket = DATA.flows[currentPeriod] || {};
    const diagnostics = flowBucket.meta || DATA.meta?.integrity?.flow_diagnostics?.[currentPeriod] || null;
    const allAccItems = getFlowItems('accumulators');
    const allSellItems = getFlowItems('sellers');
    const freshCounts = {
        accumulators: allAccItems.filter(item => isFreshFlowOverlap(item)).length,
        sellers: allSellItems.filter(item => isFreshFlowOverlap(item)).length,
    };
    const accVolume = allAccItems.reduce((sum, item) => sum + Math.max(Number(item.net_flow || 0), 0), 0);
    const sellVolume = allSellItems.reduce((sum, item) => sum + Math.abs(Number(item.net_flow || 0)), 0);
    const netTilt = accVolume - sellVolume;
    const signalStrip = document.getElementById('flow-signal-strip');
    if (signalStrip) {
        const accLeader = allAccItems[0];
        const sellLeader = allSellItems[0];
        const compactLeader = (item) => {
            if (!item) return 'None';
            const raw = item.label || shortAddr(item.address);
            return raw.length > 24 ? `${raw.slice(0, 22)}…` : raw;
        };
        const accLeaderLabel = compactLeader(accLeader);
        const sellLeaderLabel = compactLeader(sellLeader);
        const freshOverlapTotal = freshCounts.accumulators + freshCounts.sellers;
        signalStrip.innerHTML = `
            <div class="flow-signal-stat flow-signal-stat-compact">
                <div class="flow-signal-label">Accumulated</div>
                <div class="flow-signal-value accent-green">${fmt(accVolume)} ZRO</div>
                <div class="flow-signal-sub">${allAccItems.length} wallets</div>
            </div>
            <div class="flow-signal-stat flow-signal-stat-compact">
                <div class="flow-signal-label">Distributed</div>
                <div class="flow-signal-value accent-rose">${fmt(sellVolume)} ZRO</div>
                <div class="flow-signal-sub">${allSellItems.length} wallets</div>
            </div>
            <div class="flow-signal-stat flow-signal-stat-compact">
                <div class="flow-signal-label">Net tilt</div>
                <div class="flow-signal-value ${netTilt >= 0 ? 'accent-green' : 'accent-rose'}">${netTilt >= 0 ? '+' : ''}${fmt(netTilt)} ZRO</div>
                <div class="flow-signal-sub">${FLOW_COHORT_LABELS[flowCohort]} · ${currentPeriod.toUpperCase()}</div>
            </div>
            <div class="flow-signal-stat flow-signal-stat-compact flow-signal-stat-leader">
                <div class="flow-signal-label">Leader pair</div>
                <div class="flow-signal-value">${accLeaderLabel} / ${sellLeaderLabel}</div>
                <div class="flow-signal-sub">${freshOverlapTotal} fresh overlaps</div>
            </div>
        `;
    }
    ['accumulators','sellers'].forEach(type=>{
        const isAcc=type==='accumulators';
        const items=isAcc ? allAccItems : allSellItems;
        const total=items.length;
        document.getElementById(isAcc?'acc-count':'sell-count').textContent=total.toLocaleString();
        setText(isAcc ? 'acc-meta' : 'sell-meta', `${freshCounts[type]} fresh · ${fmt(items.reduce((sum, item) => sum + Math.abs(Number(item.net_flow || 0)), 0))} ZRO`);
        const page=isAcc?flowPageAcc:flowPageSell;
        const totalPages=Math.max(1,Math.ceil(total/FLOW_PER_PAGE));
        const start=(page-1)*FLOW_PER_PAGE;
        const pageItems=items.slice(start,start+FLOW_PER_PAGE);
        let html='';
        if (!pageItems.length) {
            html = `<tr><td colspan="3">${tableEmptyStateHTML(isAcc ? '🟢' : '🔴', isAcc ? 'No accumulators match this scope' : 'No sellers match this scope', `Try another cohort, chain or period inside ${currentPeriod.toUpperCase()}.`)}</td></tr>`;
        }
        pageItems.forEach((f,i)=>{
            const holder = getTrackedHolder(f.address);
            const balance = getFlowItemBalance(f, holder);
            const flowUsd=Math.abs(f.net_flow)*(DATA.meta.price_usd||0);
            const balUsd=balance*(DATA.meta.price_usd||0);
            const scoreMeta = getFlowSignalMeta(f, type, holder);
            const intensityPct = getFlowIntensityPct(f, type, holder);
            const detailKey = `${type}-${f.address}-${currentPeriod}`;
            const detailPayload = buildFlowDetailPayload(f, type, scoreMeta, flowUsd, balUsd, holder);
            html+=`<tr class="${isAcc ? 'flow-row-acc' : 'flow-row-sell'} flow-row-signal-${scoreMeta.tone}" ${clickableRowAttrs(getAddressExplorerUrl(f.address), `Open ${isAcc ? 'accumulator' : 'seller'} details`)}${registerDetailPayload(detailKey, detailPayload)}><td class="rank-cell"${dataLabelAttr('Rank')}>${start+i+1}</td><td class="flow-wallet-cell"${dataLabelAttr('Wallet')}>${buildFlowWalletCell(f, holder, balance, balUsd)}</td><td class="right ${isAcc?'val-green':'val-red'} flow-cell-main flow-signal-cell"${dataLabelAttr('Signal')}>${buildFlowSignalCell(f, type, scoreMeta, intensityPct, flowUsd, holder, balance)}</td></tr>`;
        });
        for(let i=pageItems.length;i<FLOW_PER_PAGE && total>0;i++) html+=`<tr class="empty-row">${'<td>&nbsp;</td>'.repeat(3)}</tr>`;
        document.getElementById(isAcc?'acc-tbody':'sell-tbody').innerHTML=html;
        const pagerEl=document.getElementById(isAcc?'acc-pager':'sell-pager');
        const target=isAcc?'flow-acc':'flow-sell';
        pagerEl.innerHTML=`
            ${pageButtonHTML(target, -999, '&laquo;', page<=1)}
            ${pageButtonHTML(target, -1, '&lsaquo;', page<=1)}
            <span class="pg-info">${page} / ${totalPages}</span>
            ${pageButtonHTML(target, 1, '&rsaquo;', page>=totalPages)}
            ${pageButtonHTML(target, 999, '&raquo;', page>=totalPages)}`;
    });
    const contextParts = [`${FLOW_COHORT_LABELS[flowCohort]} view`];
    if (hideCex) contextParts.push('quality filter on');
    if (flowChain !== 'all') contextParts.push(`${DATA.chains?.[flowChain]?.short || flowChain.toUpperCase()} only`);
    const freshOverlapTotal = freshCounts.accumulators + freshCounts.sellers;
    if (freshOverlapTotal) contextParts.push(`${freshCounts.accumulators} fresh accumulators · ${freshCounts.sellers} fresh sellers`);
    if (diagnostics?.chain_unresolved_rows) {
        contextParts.push(flowChain !== 'all'
            ? `${diagnostics.chain_unresolved_rows} unresolved rows hidden from chain filter`
            : `${diagnostics.chain_unresolved_rows} rows still have unresolved chain context`);
    }
    setText('flow-context-note', contextParts.join(' · '));
    updateUrlState();
}
function goFlowPage(pfx,delta){
    const type=pfx==='acc'?'accumulators':'sellers';
    const items=getFlowItems(type);
    const totalPages=Math.max(1,Math.ceil(items.length/FLOW_PER_PAGE));
    if(pfx==='acc') flowPageAcc=applyPageDelta(flowPageAcc, totalPages, delta);
    else flowPageSell=applyPageDelta(flowPageSell, totalPages, delta);
    requestHistoryMode('push');
    renderFlows();
}
function filterFlows() { flowSearchQuery=document.getElementById('flow-search').value.trim(); flowPageAcc=1; flowPageSell=1; renderFlows(); }
function setFlowChain(chain, label) {
    flowChain=chain; flowPageAcc=1; flowPageSell=1;
    document.getElementById('chain-dd-label').textContent = label || 'All Chains';
    closeFlowChainDropdown();
    requestHistoryMode('push');
    renderFlows();
}
function setFlowCohort(cohort) {
    flowCohort = ['all', 'organic', 'strategic', 'coinbase'].includes(cohort) ? cohort : 'all';
    flowPageAcc = 1;
    flowPageSell = 1;
    setActiveDataChoice('flow-cohort-pills', 'flowCohort', flowCohort);
    requestHistoryMode('push');
    renderFlows();
}
function toggleChainDropdown() {
    const menu = document.getElementById('chain-dd-menu');
    const trigger = document.getElementById('chain-dd-trigger');
    if (!menu || !trigger) return;
    const isOpen = !menu.classList.contains('open');
    closeFloatingMenus(isOpen ? 'flow-chain' : null);
    menu.classList.toggle('open', isOpen);
    trigger.classList.toggle('active', isOpen || flowChain !== 'all');
    trigger.setAttribute('aria-expanded', String(isOpen));
}
function initChainFilter() {
    const menu=document.getElementById('chain-dd-menu');
    let html=`<button type="button" class="chain-dd-item" data-flow-chain="all" data-flow-label="All Chains"><span class="chain-dd-dot" style="background:#a855f7"></span>All Chains</button>`;
    Object.entries(DATA.chains).forEach(([k,c])=>{
        const icon=CHAIN_ICONS_MAP[k]||'';
        html+=`<button type="button" class="chain-dd-item" data-flow-chain="${k}" data-flow-label="${c.short}">${icon?`<img src="${icon}" width="16" height="16" alt="" aria-hidden="true" style="border-radius:50%">`:`<span class="chain-dd-dot" style="background:${c.color}"></span>`}${c.short}</button>`;
    });
    menu.innerHTML=html;
}
function initPeriodPills() {
    document.getElementById('flow-period-pills').querySelectorAll('button').forEach(b=>{
        b.addEventListener('click',()=>{ document.querySelector('#flow-period-pills .active')?.classList.remove('active'); b.classList.add('active'); currentPeriod=b.dataset.period; flowPageAcc=1; flowPageSell=1; requestHistoryMode('push'); renderFlows(); });
    });
}

// ── Tokenomics ──
function renderAllocation() {
    const a=DATA.allocation, el=document.getElementById('alloc-section');
    const maxPct = Math.max(...Object.values(a).map(cat => cat.pct));
    let html='<div class="alloc-bars">';
    Object.values(a).forEach(cat=>{
        const unlockedPct=(cat.unlocked/cat.tokens*100).toFixed(0);
        html+=`<div class="alloc-row"><div class="alloc-color" style="background:${cat.color}"></div><div class="alloc-info"><div class="alloc-name">${cat.label}</div><div class="alloc-detail">${fmt(cat.tokens)} ZRO · ${unlockedPct}% unlocked (${fmt(cat.unlocked)})${cat.monthly_unlock?' · '+fmt(cat.monthly_unlock)+'/mo':''}</div></div><div class="alloc-pct" style="color:${cat.color}">${cat.pct}%</div></div>`;
    });
    html+='</div><div class="alloc-donut" style="flex-direction:column;gap:12px">';
    Object.values(a).forEach(cat=>{
        html+=`<div style="display:flex;align-items:center;gap:8px;width:100%"><div class="alloc-color" style="background:${cat.color}"></div><span style="font-size:11px;color:var(--text-secondary);flex:1">${cat.label}</span><div class="alloc-bar-track" style="flex:2"><div class="alloc-bar-fill" style="width:${cat.pct/maxPct*100}%;background:${cat.color}"></div></div></div>`;
    });
    html+='</div>';
    el.innerHTML=html;
}

function renderVesting() {
    const v=DATA.vesting, el=document.getElementById('vesting-section');
    const now=new Date(), start=new Date(v.cliff_end), end=new Date(v.vesting_end);
    const totalMs=end-start, elapsedMs=now-start, pct=Math.min(100,Math.max(0,(elapsedMs/totalMs)*100));
    const monthsLeft=Math.max(0,Math.ceil((end-now)/(30*24*60*60*1000)));
    const cliffLabel = start.toLocaleDateString('en-GB', {month:'short', year:'numeric'});
    const endLabel = end.toLocaleDateString('en-GB', {month:'short', year:'numeric'});
    el.innerHTML=`
        <div class="vest-progress"><div style="font-size:12px;color:var(--text-secondary);margin-bottom:4px">Vesting Progress · ${pct.toFixed(1)}% elapsed</div>
        <div class="vest-bar-track"><div class="vest-bar-fill" style="width:${pct}%"></div></div>
        <div class="vest-labels"><span>Cliff End: ${cliffLabel}</span><span>Now</span><span>Vesting End: ${endLabel}</span></div></div>
        <div class="vest-grid">
            <div class="vest-card"><div class="vest-card-label">Monthly Unlock</div><div class="vest-card-val" style="color:var(--accent-amber)">~${fmt(v.monthly_unlock_total)}</div><div class="vest-card-sub">ZRO / month (20th)</div></div>
            <div class="vest-card"><div class="vest-card-label">Next Unlock</div><div class="vest-card-val" style="color:var(--accent-rose)">${v.next_unlock.date}</div><div class="vest-card-sub">~${fmt(v.next_unlock.amount)} ZRO</div></div>
            <div class="vest-card"><div class="vest-card-label">Months Remaining</div><div class="vest-card-val">${monthsLeft}</div><div class="vest-card-sub">until full unlock</div></div>
        </div>
        ${v.schedule.map(s=>`<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:12px"><span style="color:var(--text-secondary)">${s.period}</span><span style="color:var(--text-primary);font-weight:600">${fmt(s.tokens)} ZRO</span><span style="color:var(--text-muted)">${fmtUSD(s.tokens*DATA.meta.price_usd)}</span></div>`).join('')}
        <div class="vest-correction"><div class="vest-correction-title">🚨 CEO Correction (19.77% supply repurchased)</div><div class="vest-correction-text">Bryan Pellegrino (Feb 2026): "Most public dashboards overstate unlock pressure by almost 2x." Real remaining pressure: <strong style="color:var(--accent-purple)">~${fmt(v.real_remaining)} ZRO</strong> (~${fmtUSD(v.real_monthly_usd)}/mo) vs dashboard's ~${fmt(v.total_remaining)} ZRO (~${fmtUSD(v.monthly_unlock_usd)}/mo).</div></div>`;
}

function renderBuybacks() {
    const b=DATA.buybacks, el=document.getElementById('buyback-section');
    const maxUSD=Math.max(...b.stargate_monthly.map(m=>m.usd));
    el.innerHTML=`
        <div class="bb-summary">
            <div class="bb-card"><div class="bb-card-val">${fmtUSD(b.total_2025_usd)}</div><div class="bb-card-lbl">Total Buybacks 2025</div></div>
            <div class="bb-card"><div class="bb-card-val">${fmt(b.stargate_total_tokens)}</div><div class="bb-card-lbl">Stargate ZRO Bought</div></div>
            <div class="bb-card"><div class="bb-card-val">${fmtUSD(b.stargate_total_usd)}</div><div class="bb-card-lbl">Stargate Total USD</div></div>
        </div>
        <div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;font-weight:600">Monthly Stargate Buybacks</div>
        ${b.stargate_monthly.map(m=>`<div class="bb-bar-row"><div class="bb-bar-label">${m.month}</div><div class="bb-bar-track"><div class="bb-bar-fill" style="width:${(m.usd/maxUSD*100).toFixed(0)}%">${fmt(m.tokens)}</div></div><div class="bb-bar-val">${fmtUSD(m.usd)}</div></div>`).join('')}
        <div style="margin-top:12px;font-size:11px;color:var(--text-muted)">Foundation Buyback: ${fmt(b.foundation_buyback_tokens)} ZRO (5% supply) · Labs Discretionary: ${fmtUSD(b.labs_discretionary_usd)}</div>`;
}

function renderInvestors() {
    const tbody=document.getElementById('investor-tbody');
    const riskMap={high:'risk-high',medium:'risk-medium',low:'risk-low',locked:'risk-locked',strategic:'risk-strategic'};
    const riskLabel={high:'🔴 High',medium:'🟡 Medium',low:'🟢 Low',locked:'⚪ Locked',strategic:'🔵 Strategic'};
    tbody.innerHTML=DATA.investors.map(inv=>`<tr>
        <td${dataLabelAttr('Round')} style="font-weight:600;color:var(--text-primary)">${inv.round}</td>
        <td${dataLabelAttr('Date')} style="color:var(--text-muted);font-size:11px">${inv.date}</td>
        <td${dataLabelAttr('Raised')} style="font-variant-numeric:tabular-nums">${inv.raised?fmtUSD(inv.raised):'<span style="color:var(--text-muted)">Undisclosed</span>'}</td>
        <td${dataLabelAttr('Est. Price')} style="font-variant-numeric:tabular-nums">${inv.price_est?'$'+inv.price_est.toFixed(2):'<span style="color:var(--text-muted)">—</span>'}</td>
        <td${dataLabelAttr('ROI Today')} style="font-weight:600;${inv.roi&&parseFloat(inv.roi)>1?'color:var(--accent-green)':inv.roi&&parseFloat(inv.roi)<1?'color:var(--accent-rose)':'color:var(--text-muted)'}">${inv.roi||'—'}</td>
        <td${dataLabelAttr('Sell Risk')}><span class="${riskMap[inv.risk]||''}" style="font-size:11px">${riskLabel[inv.risk]||inv.risk}</span></td>
        <td${dataLabelAttr('Investors')} style="font-size:10px;color:var(--text-muted);line-height:1.4">${inv.investors}</td>
    </tr>`).join('');
}

function renderValueStreams() {
    const el=document.getElementById('value-section');
    el.innerHTML=`<div class="vs-grid">${DATA.value_streams.map(v=>`<div class="vs-item"><div class="vs-dot ${v.status}"></div><div class="vs-info"><div class="vs-name">${v.source}</div><div class="vs-mech">${v.mechanism}</div></div><div class="vs-impact">${v.impact}</div></div>`).join('')}</div>`;
}

function renderTimeline() {
    const el=document.getElementById('dates-section');
    el.innerHTML=`<div class="tl-list">${DATA.key_dates.map(d=>{
        const dt=new Date(d.date), now=new Date(), isPast=dt<now;
        return `<div class="tl-item"><div class="tl-dot ${d.type}"></div><div class="tl-date">${d.date}${isPast?' ✓':''}</div><div class="tl-event">${d.event}</div><div class="tl-detail">${d.detail}</div></div>`;
    }).join('')}</div>`;
}

// ── Data Freshness ──
function updateFreshness() {
    const footerEl = document.getElementById('footer-updated');
    const bannerEl = document.getElementById('snapshot-banner');
    if((!footerEl && !bannerEl) || !DATA || !DATA.meta) return;
    const freshness = getSnapshotStatusMeta();
    if (!freshness) return;
    const { ageLabel, status, statusIcon, statusColor, chipLabel, absoluteLabel } = freshness;
    if (footerEl) {
        footerEl.innerHTML = `<span style="color:${statusColor}">${statusIcon}</span> Snapshot Updated ${ageLabel} <span style="color:var(--text-muted);font-size:11px">(${absoluteLabel})</span>`;
    }
    if (bannerEl) {
        const title = status === 'fresh'
            ? `Indexed on-chain tables were refreshed ${ageLabel}.`
            : status === 'delayed'
                ? `Indexed on-chain tables are slightly delayed and were refreshed ${ageLabel}.`
                : `On-chain tables currently reflect an older indexed snapshot from ${absoluteLabel}.`;
        const detail = status === 'fresh'
            ? 'Token price refreshes live from CoinGecko, and period filters plus relative ages are anchored to the recent indexed dataset.'
            : status === 'delayed'
                ? 'Token price refreshes live from CoinGecko, while holder tables, flows, whale activity and relative ages use the latest indexed dataset available locally.'
                : 'Token price still refreshes live from CoinGecko, but holder tables, flows, whale activity and relative ages stay tied to the last indexed dataset until zro_data.json is regenerated.';
        bannerEl.className = `snapshot-banner snapshot-${status}`;
        bannerEl.innerHTML = `
            <div class="snapshot-banner-inner">
                <span class="snapshot-chip">${chipLabel}</span>
                <div class="snapshot-copy">
                    <div class="snapshot-title">${title}</div>
                    <div class="snapshot-detail">${detail}</div>
                </div>
            </div>`;
    }
    renderHeaderStatus();
}

// ── Whale Transfers ──
let whalePageNum = 1;
let whaleFilter = 'ALL';
const WHALE_PER_PAGE = 15;
// Known CEX addresses for label resolution (mirrors monitor_whale_transfers.py KNOWN_CEX)
const KNOWN_CEX_LABELS = {
    '0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43': 'Coinbase',
    '0x503828976d22510aad0201ac7ec88293211d23da': 'Coinbase',
    '0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740': 'Coinbase',
    '0x3cd751e6b0078be393132286c442345e68ff0afc': 'Coinbase',
    '0xb5d85cbf7cb3ee0d56b3bb207d5fc4b82f43f511': 'Coinbase',
    '0x28c6c06298d514db089934071355e5743bf21d60': 'Binance',
    '0x21a31ee1afc51d94c2efccaa2092ad1028285549': 'Binance',
    '0xdfd5293d8e347dfe59e90efd55b2956a1343963d': 'Binance',
    '0x56eddb7aa87536c09ccc2793473599fd21a8b17f': 'Binance',
    '0xb5bc3e38b5b683ce357ffd04d70354dcbbf813b2': 'Binance',
    '0x91d40e4818f4d4c57b4578d9eca6afc92ac8debe': 'OKX',
    '0x841ed663f2636863d40be4ee76243377dff13a34': 'Robinhood',
    '0x6cc5f688a315f3dc28a7781717a9a798a59fda7b': 'OKX',
    '0x236f9f97e0e62388479bf9e5ba4889e46b0273c3': 'OKX',
    '0x4a4aaa0155237881fbd5c34bfae16e985a7b068d': 'OKX',
    '0xf89d7b9c864f589bbf53a82105107622b35eaa40': 'Bybit',
    '0x1db92e2eebc8e0c075a02bea49a2935bcd2dfcf4': 'Bybit',
    '0xeb2629a2734e272bcc07bda959863f316f4bd4cf': 'Coinbase',
    '0x6e1abc08ad3a845726ac93c0715be2d7c9e7129b': 'Coinbase',
    '0x137f79a70fc9c6d5c80f94a5fc44bd95a567652d': 'Coinbase',
    '0xaeee6e35eb33a464a82a51dbf52e85da137b6bcc': 'Coinbase',
    '0x94e19e5c29a75b1b1bdcf247bb55425ca7d319d4': 'Coinbase',
    '0x63be42b40816eb08f6ea480e5875e6f4668da379': 'Upbit',
    '0xf977814e90da44bfa03b6295a0616a897441acec': 'Binance',
    '0x5a52e96bacdabb82fd05763e25335261b270efcb': 'Binance',
    '0xa6bf06200361009491bad8c57410c9ded24c2444': 'OKX',
    '0xcd531ae9efcce479654c4926dec5f6209531ca7b': 'Coinbase Prime Hub',
    '0xfdd710fa25cf1e08775cb91a2bf65f1329ccbd09': 'Binance',
    '0x723a7d0d7a3ab85c851db744edf789855088c9e3': 'Contract',
    '0x84b38bc60f3bd82640ecefa320dab2be62e2da15': 'Market Maker / Bridge',
    '0x4355951b4f1a5bab81a3bebcbf9f263302cc742d': 'Alameda Research',
    '0x6540f4a2f4c4fbac288fa738a249924a636020d0': 'Upbit',
    '0x56264e5ec5215c3974cfb550d3aefa6720f5ee9d': 'Borderless Capital',
};
function buildWhaleLabelMap() {
    const map = {};
    // 1. Labels from top_holders
    for (const h of DATA.top_holders) {
        if (h.label && !KNOWN_CEX_LABELS[h.address.toLowerCase()]) map[h.address.toLowerCase()] = h.label;
    }
    // 2. Known CEX addresses (must remain canonical)
    for (const [addr, name] of Object.entries(KNOWN_CEX_LABELS)) map[addr.toLowerCase()] = name;
    return map;
}
function getWhaleFilterKey(transfer) {
    if (transfer?.type === 'CEX_WITHDRAWAL') return 'BUY';
    if (transfer?.type === 'CEX_DEPOSIT') return 'SELL';
    return 'MOVE';
}
function whaleMatchesFilter(transfer) {
    return whaleFilter === 'ALL' || getWhaleFilterKey(transfer) === whaleFilter;
}
function setWhaleFilter(nextFilter) {
    const resolved = pickAllowedValue(nextFilter, ['ALL', 'BUY', 'SELL', 'MOVE'], 'ALL');
    if (resolved === whaleFilter) return;
    whaleFilter = resolved;
    whalePageNum = 1;
    requestHistoryMode('push');
    renderWhaleTransfers();
}
function getWhaleContextMeta(transfer, holder=getTrackedHolder(transfer.to)) {
    if (KNOWN_CEX_LABELS[transfer.to.toLowerCase()]) {
        const label = transfer.to_label || KNOWN_CEX_LABELS[transfer.to.toLowerCase()] || 'CEX';
        const cohort = label.toLowerCase().includes('coinbase') ? 'coinbase' : 'cex';
        return { label: cohort === 'coinbase' ? 'Coinbase / Custody' : 'CEX destination', className: cohort === 'coinbase' ? 'h-badge-flow-cohort h-badge-flow-coinbase' : 'h-badge-cex', tone: cohort };
    }
    const freshSignal = holder?.fresh_signal || '';
    if (freshSignal === 'fresh_whale_accumulator' || freshSignal === 'fresh_accumulator') {
        return { label: FRESH_FLOW_LABELS[freshSignal], className: `h-badge-flow-fresh h-badge-flow-fresh-${freshSignal}`, tone: 'fresh' };
    }
    if (holder?.type === 'FRESH' || holder?.label === 'Fresh Wallet') {
        return { label: 'Fresh wallet', className: 'h-badge-fresh', tone: 'fresh' };
    }
    const cohort = getFlowCohort({ address: transfer.to, label: holder?.label, type: holder?.type }, holder);
    if (cohort === 'coinbase') {
        return { label: FLOW_COHORT_LABELS.coinbase, className: 'h-badge-flow-cohort h-badge-flow-coinbase', tone: 'coinbase' };
    }
    if (cohort === 'strategic') {
        return { label: FLOW_COHORT_LABELS.strategic, className: 'h-badge-flow-cohort h-badge-flow-strategic', tone: 'strategic' };
    }
    if (holder?.type) {
        const badgeClass = {'CEX':'h-badge-cex','DEX':'h-badge-dex','PROTOCOL':'h-badge-protocol','VC':'h-badge-vc','INST':'h-badge-inst','WALLET':'h-badge-wallet','TEAM':'h-badge-team','WHALE':'h-badge-whale','CUSTODY':'h-badge-custody','MULTISIG':'h-badge-multisig','MM':'h-badge-mm','UNLOCK':'h-badge-unlock'}[holder.type] || 'h-badge-whale';
        return { label: holder.type === 'WALLET' ? 'Tracked wallet' : holder.type, className: badgeClass, tone: holder.type.toLowerCase() };
    }
    return { label: 'Unlabeled destination', className: 'h-badge-flow-profile', tone: 'neutral' };
}
function getWhaleScoreMeta(transfer, fromHolder=getTrackedHolder(transfer.from), toHolder=getTrackedHolder(transfer.to)) {
    let score = Math.min(Number(transfer.value || 0) / 100000, 20);
    if (transfer.type === 'CEX_WITHDRAWAL') score += 2.4;
    else if (transfer.type === 'CEX_DEPOSIT') score += 1.2;
    const freshSignal = toHolder?.fresh_signal || '';
    if (freshSignal === 'fresh_whale_accumulator') score += 3.2;
    else if (freshSignal === 'fresh_accumulator') score += 2.4;
    else if (toHolder?.type === 'FRESH' || toHolder?.label === 'Fresh Wallet') score += 1.3;
    if (toHolder?.type === 'WHALE') score += 1.3;
    if (toHolder?.type === 'VC' || toHolder?.type === 'INST') score += 0.8;
    if (fromHolder?.type === 'WHALE') score += 0.45;
    if (fromHolder?.type === 'VC' || fromHolder?.type === 'INST') score += 0.35;
    const rounded = Math.round(score * 10) / 10;
    if (rounded >= 12) return { value: rounded, label: 'Prime', className: 'whale-score-prime' };
    if (rounded >= 8) return { value: rounded, label: 'High', className: 'whale-score-high' };
    if (rounded >= 5) return { value: rounded, label: 'Watch', className: 'whale-score-watch' };
    return { value: rounded, label: 'Track', className: 'whale-score-track' };
}
function whaleScoreBadgeHTML(scoreMeta, compact=false) {
    if (compact && ['Track', 'Watch'].includes(scoreMeta.label)) return '';
    const content = compact ? scoreMeta.label : `${scoreMeta.label} ${scoreMeta.value.toFixed(1)}`;
    return `<span class="whale-score-badge ${escapeAttr(scoreMeta.className)}" title="Whale score ${escapeAttr(scoreMeta.value.toFixed(1))}">${escapeHtml(content)}</span>`;
}
function whaleContextBadgeHTML(contextMeta) {
    return `<span class="h-badge ${escapeAttr(contextMeta.className)} whale-context-badge">${escapeHtml(contextMeta.label)}</span>`;
}
function whaleTypeBadgeHTML(holder) {
    if (!holder?.type || holder.type === 'WALLET') return '';
    const badgeClass = {'CEX':'h-badge-cex','DEX':'h-badge-dex','PROTOCOL':'h-badge-protocol','VC':'h-badge-vc','INST':'h-badge-inst','TEAM':'h-badge-team','WHALE':'h-badge-whale','CUSTODY':'h-badge-custody','MULTISIG':'h-badge-multisig','MM':'h-badge-mm','UNLOCK':'h-badge-unlock','FRESH':'h-badge-fresh'}[holder.type] || 'h-badge-whale';
    const badgeLabel = {
        CEX: 'CEX',
        DEX: 'DEX',
        PROTOCOL: 'Protocol',
        VC: 'VC',
        INST: 'Institutional',
        TEAM: 'Team',
        WHALE: 'Whale',
        CUSTODY: 'Custody',
        MULTISIG: 'Multisig',
        MM: 'MM',
        UNLOCK: 'Unlock',
        FRESH: 'Fresh',
    }[holder.type] || holder.type;
    return `<span class="h-badge ${badgeClass} whale-context-badge">${escapeHtml(badgeLabel)}</span>`;
}
function whaleCohortBadgeHTML(address, holder) {
    if (!holder) return '';
    const cohort = getFlowCohort({ address, label: holder.label, type: holder.type }, holder);
    if (cohort === 'all' || cohort === 'organic') return '';
    return `<span class="h-badge h-badge-flow-cohort h-badge-flow-${escapeAttr(cohort)} whale-context-badge">${escapeHtml(FLOW_COHORT_LABELS[cohort] || cohort)}</span>`;
}
function isGenericWhaleEntityLabel(label) {
    const normalized = String(label || '').trim().toLowerCase();
    return !!normalized && ['whale', 'wallet', 'holder', 'address', 'unknown'].includes(normalized);
}
function buildWhaleCounterpartyCell(address, resolvedLabel, holder, options={}) {
    const short = shortAddr(address);
    const hasGenericLabel = isGenericWhaleEntityLabel(resolvedLabel);
    const linkLabel = hasGenericLabel ? short : (resolvedLabel || short);
    const explorerUrl = `https://etherscan.io/address/${address}`;
    const debankUrl = `https://debank.com/profile/${address}`;
    const typeBadge = options.showTypeBadge ? whaleTypeBadgeHTML(holder) : '';
    const cohortBadge = options.showCohortBadge ? whaleCohortBadgeHTML(address, holder) : '';
    const subAddress = resolvedLabel && !hasGenericLabel ? `<span class="whale-entity-address">${short}</span>` : '';
    const balance = holder ? getHolderTotalBalance(holder) : 0;
    const balanceLine = options.showBalance && balance > 0
        ? `<div class="whale-entity-balance">${fmt(balance)} ZRO</div>`
        : '';
    const routeLine = options.routeNote
        ? `<div class="whale-route-note">${escapeHtml(options.routeNote)}</div>`
        : '';
    return `<div class="h-addr-two-line whale-entity-stack"><div class="h-addr-line1"><a href="${explorerUrl}" target="_blank" rel="noopener noreferrer" class="h-addr-hex-sm whale-entity-link">${linkLabel}</a>${debankIconHTML(debankUrl)}</div><div class="h-whale-meta-row whale-entity-meta">${typeBadge}${cohortBadge}${subAddress}</div>${balanceLine}${routeLine}</div>`;
}
function buildWhaleDetailPayload(transfer, fromResolved, toResolved, contextMeta, scoreMeta, usdVal, timeStr, agoStr) {
    const amountLabel = `${transfer.type === 'CEX_DEPOSIT' ? '-' : '+'}${fmt(transfer.value)} ZRO`;
    return {
        eyebrow: 'Whale transfer',
        title: `${transfer.type === 'CEX_WITHDRAWAL' ? 'Buy-side' : transfer.type === 'CEX_DEPOSIT' ? 'Sell-side' : 'Large transfer'} signal`,
        subtitle: `${timeStr} · ${agoStr}`,
        badges: [
            { label: transfer.type === 'CEX_WITHDRAWAL' ? 'BUY' : transfer.type === 'CEX_DEPOSIT' ? 'SELL' : 'MOVE', tone: transfer.type === 'CEX_WITHDRAWAL' ? 'buy' : transfer.type === 'CEX_DEPOSIT' ? 'sell' : 'neutral' },
            { label: contextMeta.label, tone: contextMeta.tone || 'neutral' },
            { label: `${scoreMeta.label} ${scoreMeta.value.toFixed(1)}`, tone: scoreMeta.className.replace('whale-score-', '') },
        ],
        metrics: [
            { label: 'Amount', value: amountLabel, sub: usdVal || 'USD unavailable' },
            { label: 'Whale score', value: scoreMeta.value.toFixed(1), sub: scoreMeta.label },
            { label: 'Type', value: transfer.type.replace('_', ' '), sub: 'Ethereum transfer' },
        ],
        sectionTitle: 'Counterparties',
        list: [
            { label: 'From', value: fromResolved },
            { label: 'To', value: toResolved },
            { label: 'Recipient context', value: contextMeta.label },
            { label: 'Transaction', value: shortAddr(transfer.tx_hash) },
        ],
        actions: [
            { label: 'Open transaction', url: `https://etherscan.io/tx/${transfer.tx_hash}`, primary: true },
            { label: 'Open recipient', url: `https://etherscan.io/address/${transfer.to}` },
        ],
    };
}
function renderWhaleTransfers() {
    const transfers = (DATA.whale_transfers || []).slice().sort((a, b) => b.timestamp - a.timestamp);
    const card = document.getElementById('whale-card');
    if (!card) return;
    if (!transfers.length) { card.style.display = 'none'; return; }
    card.style.display = '';
    setActiveDataChoice('whale-filter-pills', 'whaleFilter', whaleFilter);
    const labelMap = buildWhaleLabelMap();
    const filteredTransfers = transfers.filter(whaleMatchesFilter);
    const total = transfers.length;
    const filteredTotal = filteredTransfers.length;
    const totalPages = Math.max(1, Math.ceil(Math.max(filteredTotal, 1) / WHALE_PER_PAGE));
    whalePageNum = Math.min(whalePageNum, totalPages);
    const start = (whalePageNum - 1) * WHALE_PER_PAGE;
    const pageItems = filteredTransfers.slice(start, start + WHALE_PER_PAGE);
    const price = DATA.meta.price_usd || 0;
    const whaleSignalStrip = document.getElementById('whale-signal-strip');
    if (whaleSignalStrip) {
        const buyRows = filteredTransfers.filter(t => t.type === 'CEX_WITHDRAWAL');
        const sellRows = filteredTransfers.filter(t => t.type === 'CEX_DEPOSIT');
        const moveRows = filteredTransfers.filter(t => t.type === 'TRANSFER');
        const buyVolume = buyRows.reduce((sum, t) => sum + Number(t.value || 0), 0);
        const sellVolume = sellRows.reduce((sum, t) => sum + Number(t.value || 0), 0);
        const topSignal = filteredTransfers
            .map(t => ({ transfer: t, meta: getWhaleScoreMeta(t, getTrackedHolder(t.from), getTrackedHolder(t.to)) }))
            .sort((a, b) => b.meta.value - a.meta.value)[0];
        const topSignalEntity = topSignal
            ? (labelMap[topSignal.transfer.to.toLowerCase()] || topSignal.transfer.to_label || shortAddr(topSignal.transfer.to))
            : 'None';
        const compactEntity = topSignalEntity.length > 20 ? `${topSignalEntity.slice(0, 18)}…` : topSignalEntity;
        whaleSignalStrip.innerHTML = `
            <div class="whale-signal-stat whale-signal-stat-compact">
                <div class="whale-signal-label">Scope</div>
                <div class="whale-signal-value">${filteredTotal}</div>
                <div class="whale-signal-sub">${WHALE_FILTER_LABELS[whaleFilter]}</div>
            </div>
            <div class="whale-signal-stat whale-signal-stat-compact">
                <div class="whale-signal-label">Buys</div>
                <div class="whale-signal-value accent-green">${fmt(buyVolume)} ZRO</div>
                <div class="whale-signal-sub">${buyRows.length} rows</div>
            </div>
            <div class="whale-signal-stat whale-signal-stat-compact">
                <div class="whale-signal-label">Sells</div>
                <div class="whale-signal-value accent-rose">${fmt(sellVolume)} ZRO</div>
                <div class="whale-signal-sub">${sellRows.length} rows</div>
            </div>
            <div class="whale-signal-stat whale-signal-stat-compact whale-signal-stat-leader">
                <div class="whale-signal-label">Lead signal</div>
                <div class="whale-signal-value">${topSignal ? `${topSignal.meta.label} / ${compactEntity}` : 'No standout row'}</div>
                <div class="whale-signal-sub">${moveRows.length} moves</div>
            </div>
        `;
    }
    let html = '';
    if (!pageItems.length) {
        html = `<tr><td colspan="5">${tableEmptyStateHTML('🐋', 'No whale transfers for this filter', `Switch back to ${WHALE_FILTER_LABELS.ALL.toLowerCase()} or wait for the next indexed snapshot.`)}</td></tr>`;
    }
    pageItems.forEach(t => {
        const fromHolder = getTrackedHolder(t.from);
        const toHolder = getTrackedHolder(t.to);
        const date = new Date(t.timestamp * 1000);
        const timeStr = date.toLocaleDateString('en-GB', {day:'numeric',month:'short'}) + ' ' + date.toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'});
        const agoStr = formatDaysAgoFromSnapshot(t.timestamp);
        const typeCls = t.type === 'CEX_WITHDRAWAL' ? 'h-badge-fresh' : t.type === 'CEX_DEPOSIT' ? 'h-badge-sell' : 'h-badge-inst';
        const typeLabel = t.type === 'CEX_WITHDRAWAL' ? '🟢 BUY' : t.type === 'CEX_DEPOSIT' ? '🔴 SELL' : '🔄 MOVE';
        const fromResolved = labelMap[t.from.toLowerCase()] || t.from_label;
        const toResolved = labelMap[t.to.toLowerCase()] || t.to_label;
        const contextMeta = getWhaleContextMeta(t, toHolder);
        const scoreMeta = getWhaleScoreMeta(t, fromHolder, toHolder);
        const fromShort = fromResolved || (t.from.slice(0,6) + '…' + t.from.slice(-4));
        const toShort = toResolved || (t.to.slice(0,6) + '…' + t.to.slice(-4));
        const fromCell = buildWhaleCounterpartyCell(t.from, fromShort, fromHolder, {
            routeNote: t.type === 'CEX_WITHDRAWAL' ? 'Liquidity source' : t.type === 'CEX_DEPOSIT' ? 'Distribution source' : 'Sender',
            showTypeBadge: false,
            showCohortBadge: false,
            showBalance: false,
        });
        const toCell = buildWhaleCounterpartyCell(t.to, toShort, toHolder, {
            showTypeBadge: true,
            showCohortBadge: true,
            showBalance: true,
        });
        const usdVal = price ? fmtUSD(t.value * price) : '';
        const amtColor = t.type === 'CEX_DEPOSIT' ? 'color:#f87171' : 'color:#4ade80';
        const amtSign = t.type === 'CEX_DEPOSIT' ? '-' : '+';
        const compactScoreBadge = whaleScoreBadgeHTML(scoreMeta, true);
        const whaleRowClass = [
            'whale-row',
            t.type === 'CEX_WITHDRAWAL' ? 'whale-row-buy' : t.type === 'CEX_DEPOSIT' ? 'whale-row-sell' : 'whale-row-transfer',
            `whale-score-row-${scoreMeta.className.replace('whale-score-', '')}`,
        ].join(' ');
        const detailKey = `whale-${t.event_id || t.tx_hash}`;
        const detailPayload = buildWhaleDetailPayload(t, fromShort, toShort, contextMeta, scoreMeta, usdVal, timeStr, agoStr);
        html += `<tr class="${whaleRowClass}" ${clickableRowAttrs(`https://etherscan.io/tx/${t.tx_hash}`, 'Open whale transfer transaction')}${registerDetailPayload(detailKey, detailPayload)} style="cursor:pointer">
            <td${dataLabelAttr('Time')}><div class="fresh-date">${timeStr}</div><div class="val-muted">${agoStr}</div></td>
            <td${dataLabelAttr('Type')}><span class="h-badge ${typeCls}">${typeLabel}</span></td>
            <td${dataLabelAttr('From')}>${fromCell}</td>
            <td${dataLabelAttr('To')}>${toCell}</td>
            <td class="right whale-amount-cell" style="${amtColor};font-weight:600"${dataLabelAttr('Amount')}><div class="whale-amount-stack"><div class="whale-amount-top">${compactScoreBadge}<span>${amtSign}${fmt(t.value)} ZRO</span></div></div></td>
        </tr>`;
    });
    document.getElementById('whale-tbody').innerHTML = html;
    setText('whale-count', `${filteredTotal}${whaleFilter === 'ALL' ? '' : ` / ${total}`} rows`);
    document.getElementById('whale-sub').textContent = `${filteredTotal} ${WHALE_FILTER_LABELS[whaleFilter].toLowerCase()} in the indexed Ethereum feed`;
    const pager = document.getElementById('whale-pager');
    pager.innerHTML = `
        ${pageButtonHTML('whale', -999, '&laquo;', whalePageNum<=1)}
        ${pageButtonHTML('whale', -1, '&lsaquo;', whalePageNum<=1)}
        <span class="pg-info">${whalePageNum} / ${totalPages}</span>
        ${pageButtonHTML('whale', 1, '&rsaquo;', whalePageNum>=totalPages)}
        ${pageButtonHTML('whale', 999, '&raquo;', whalePageNum>=totalPages)}`;
    updateUrlState();
}
function goWhalePage(delta) {
    const totalPages = Math.max(1, Math.ceil((DATA.whale_transfers || []).length / WHALE_PER_PAGE));
    whalePageNum = applyPageDelta(whalePageNum, totalPages, delta);
    requestHistoryMode('push');
    renderWhaleTransfers();
}

// ── Init ──
async function init() {
    compactTableMode = isCompactTableMode();
    setLoadingState(true);
    try { DATA=normalizeLoadedData(await(await fetch('zro_data.json?v=' + new Date().getTime())).json()); }
    catch(e) {
        setLoadingState(false);
        document.querySelector('.page-wrapper').innerHTML='<div style="text-align:center;padding:80px;color:var(--text-muted)"><h2 style="color:var(--accent-rose)">Failed to load data</h2><p style="margin-top:8px">The local snapshot could not be loaded. Check zro_data.json and refresh the page.</p></div>';
        return;
    }
    applyStateFromUrl();
    initTabs();
    initEventDelegation();
    initChainFilter();
    initPeriodPills();
    initCbPeriodPills();
    initCbtPills();
    syncControlsFromState();
    renderMetrics(); renderNetworkStats(); renderChains(); renderHolders(); renderFreshWallets(); renderCoinbasePrime(); renderCbTransfers(); renderNewInstitutional(); renderFlows(); renderWhaleTransfers();
    renderAllocation(); renderVesting(); renderBuybacks(); renderInvestors(); renderValueStreams(); renderTimeline();
    stateSyncReady = true;
    updateUrlState();
    updateFreshness(); setInterval(updateFreshness, 30000);
    fetchPrice(); setInterval(fetchPrice,60000);
    setLoadingState(false);
}
document.addEventListener('DOMContentLoaded', init);
