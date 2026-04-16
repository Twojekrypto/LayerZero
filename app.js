/* ZRO Analytics Dashboard — app.js */
let DATA = null, currentPeriod = '30d', holdersPage = 1, toastTimer = null, activeTab = 'overview', stateSyncReady = false, nextHistoryMode = 'replace';
const HOLDERS_PER_PAGE = 25, FLOW_PER_PAGE = 10;
let holdersSortKey = 'total', holdersSortDir = 'desc', holdersSearchQuery = '', holdersHideEntities = false;
const HIDDEN_HOLDER_ENTITY_TYPES = new Set(['CEX', 'DEX', 'PROTOCOL', 'INST', 'VC', 'TEAM', 'CUSTODY', 'MULTISIG', 'MM', 'UNLOCK']);

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
function setActivePill(containerId, value) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('button').forEach(btn => btn.classList.toggle('active', btn.dataset.period === String(value)));
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

function addrCell(item) {
    const addr=item.address, shortA=addr.slice(0,6)+'…'+addr.slice(-4);
    const chain = getMainChain(addr);
    const explorerUrl = (EXPLORER_MAP[chain] || EXPLORER_MAP.ethereum) + addr;
    const dbUrl=`https://debank.com/profile/${addr}`;
    const copyButton = copyButtonHTML(addr);
    const dbIcon = debankIconHTML(dbUrl);
    const explorerIcon = explorerIconHTML(explorerUrl, `View ${shortA} on explorer`);
    if (item.label) {
        const bCls={'CEX':'h-badge-cex','DEX':'h-badge-dex','PROTOCOL':'h-badge-protocol','VC':'h-badge-vc','INST':'h-badge-inst','WALLET':'h-badge-wallet','TEAM':'h-badge-team','WHALE':'h-badge-whale','CUSTODY':'h-badge-custody','MULTISIG':'h-badge-multisig','MM':'h-badge-mm','FRESH':'h-badge-fresh','UNLOCK':'h-badge-unlock','NEW_INST':'h-badge-inst'}[item.type]||'h-badge-whale';
        return `<div class="h-addr-two-line"><div class="h-addr-line1"><a href="${explorerUrl}" target="_blank" rel="noopener noreferrer" class="h-addr-label">${item.label}</a><span class="h-badge ${bCls}">${item.type}</span></div><div class="h-addr-line2"><span class="h-addr-hex-sm">${shortA}</span>${copyButton}${dbIcon}${explorerIcon}</div></div>`;
    }
    return `<div class="h-addr-two-line"><div class="h-addr-line1"><a href="${explorerUrl}" target="_blank" rel="noopener noreferrer" class="h-addr-hex">${shortA}</a>${copyButton}${dbIcon}${explorerIcon}</div></div>`;
}

// ── Tabs ──
function setActiveTab(tabId, options = {}) {
    const nextTab = ['overview', 'flows', 'tokenomics'].includes(tabId) ? tabId : 'overview';
    activeTab = nextTab;
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
    freshSortKey = pickAllowedValue(params.get('freshSort'), ['date', 'flow', 'balance'], 'balance');
    freshSortDir = pickAllowedValue(params.get('freshDir'), ['asc', 'desc'], 'desc');
    freshPage = parsePositiveInt(params.get('freshPage'), 1);

    cbSearchQuery = params.get('cbSearch')?.trim() || '';
    cbPeriodDays = Number.parseInt(pickAllowedValue(params.get('cbPeriod'), ['0', '1', '7', '30', '90', '180'], '0'), 10);
    cbSortKey = pickAllowedValue(params.get('cbSort'), ['date', 'flow', 'balance'], 'balance');
    cbSortDir = pickAllowedValue(params.get('cbDir'), ['asc', 'desc'], 'desc');
    cbPage = parsePositiveInt(params.get('cbPage'), 1);

    cbtSearchQuery = params.get('cbtSearch')?.trim() || '';
    cbtTypeFilter = pickAllowedValue(params.get('cbtType'), ['ALL', 'BUY', 'SELL', 'TRANSFER', 'OUTFLOW', 'INFLOW'], 'ALL');
    cbtPeriodDays = Number.parseInt(pickAllowedValue(params.get('cbtPeriod'), ['0', '1', '7', '30', '90', '180'], '0'), 10);
    cbtSortDir = Number.parseInt(pickAllowedValue(params.get('cbtSort'), ['0', '1', '2'], '0'), 10);
    cbtPage = parsePositiveInt(params.get('cbtPage'), 1);

    flowSearchQuery = params.get('flowSearch')?.trim() || '';
    flowChain = pickAllowedValue(params.get('flowChain'), ['all', ...Object.keys(DATA.chains || {})], 'all');
    hideCex = parseBooleanParam(params.get('hideCex'));
    flowPageAcc = parsePositiveInt(params.get('flowAccPage'), 1);
    flowPageSell = parsePositiveInt(params.get('flowSellPage'), 1);

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
    if (freshSortKey !== 'balance') params.set('freshSort', freshSortKey);
    if (freshSortDir !== 'desc') params.set('freshDir', freshSortDir);
    if (freshPage !== 1) params.set('freshPage', String(freshPage));

    if (cbSearchQuery) params.set('cbSearch', cbSearchQuery);
    if (cbPeriodDays !== 0) params.set('cbPeriod', String(cbPeriodDays));
    if (cbSortKey !== 'balance') params.set('cbSort', cbSortKey);
    if (cbSortDir !== 'desc') params.set('cbDir', cbSortDir);
    if (cbPage !== 1) params.set('cbPage', String(cbPage));

    if (cbtSearchQuery) params.set('cbtSearch', cbtSearchQuery);
    if (cbtTypeFilter !== 'ALL') params.set('cbtType', cbtTypeFilter);
    if (cbtPeriodDays !== 0) params.set('cbtPeriod', String(cbtPeriodDays));
    if (cbtSortDir !== 0) params.set('cbtSort', String(cbtSortDir));
    if (cbtPage !== 1) params.set('cbtPage', String(cbtPage));

    if (flowSearchQuery) params.set('flowSearch', flowSearchQuery);
    if (flowChain !== 'all') params.set('flowChain', flowChain);
    if (hideCex) params.set('hideCex', '1');
    if (flowPageAcc !== 1) params.set('flowAccPage', String(flowPageAcc));
    if (flowPageSell !== 1) params.set('flowSellPage', String(flowPageSell));

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
    setInputValue('cb-search', cbSearchQuery);
    setInputValue('cbt-search', cbtSearchQuery);
    setInputValue('flow-search', flowSearchQuery);

    setActivePill('flow-period-pills', currentPeriod);
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

    const flowHideButton = event.target.closest('#flow-hide-cex');
    if (flowHideButton) {
        toggleHideCex();
        return;
    }

    const pageButton = event.target.closest('[data-page-target]');
    if (pageButton) {
        handlePageButtonClick(pageButton.dataset.pageTarget, Number.parseInt(pageButton.dataset.pageDelta, 10));
        return;
    }

    const row = event.target.closest('[data-nav-url]');
    if (row) {
        if (event.target.closest('a, button, input, label')) return;
        navigateToExternal(row.dataset.navUrl);
    }
}
function handleDelegatedKeydown(event) {
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
function initEventDelegation() {
    document.addEventListener('input', handleDelegatedInput);
    document.addEventListener('change', handleDelegatedChange);
    document.addEventListener('click', handleDelegatedClick);
    document.addEventListener('keydown', handleDelegatedKeydown);
    document.addEventListener('error', handleDelegatedAssetError, true);
    window.addEventListener('popstate', handlePopState);
}
function renderStatefulViews() {
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
    const entries=Object.entries(DATA.chains).sort((a,b)=>b[1].supply-a[1].supply);
    const totalSupply=entries.reduce((s,[,c])=>s+c.supply,0);
    const totalHolders=entries.reduce((s,[,c])=>s+c.holders,0);
    const maxSupply=entries[0][1].supply;
    const maxHolders=Math.max(...entries.map(([,c])=>c.holders));
    document.getElementById('chain-bars').innerHTML=entries.map(([k,c])=>{
        const pct=(c.supply/maxSupply*100).toFixed(1), sPct=(c.supply/totalSupply*100).toFixed(1);
        return `<a class="chain-bar-row" href="${c.explorer}" target="_blank" rel="noopener noreferrer" aria-label="Open ${c.name} explorer"><div class="chain-bar-label"><span class="chain-dot" style="background:${c.color}"></span>${c.short}</div><div class="chain-bar-track"><div class="chain-bar-fill" style="width:${pct}%;background:${c.color}">${sPct}%</div></div><div class="chain-bar-value">${fmt(c.supply)}</div></a>`;
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
    let total=0; for(const k of CHAIN_KEYS) total+=(h.balances[k]||0); return total;
}
function renderHolders() {
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
    page.forEach((h,idx)=>{
        const dbUrl=`https://debank.com/profile/${h.address}`;
        const shortA=h.address.slice(0,6)+'…'+h.address.slice(-4);
        const dispBal=getDisplayBalance(h);
        const usdVal=dispBal*price;
        const dbIcon=debankIconHTML(dbUrl);
        const copyButton=copyButtonHTML(h.address);
        let addrTd;
        if(h.label){
            const bCls={'CEX':'h-badge-cex','PROTOCOL':'h-badge-protocol','INST':'h-badge-inst','VC':'h-badge-vc','DEX':'h-badge-dex','TEAM':'h-badge-team','WHALE':'h-badge-whale','CUSTODY':'h-badge-custody','MULTISIG':'h-badge-multisig','MM':'h-badge-mm','FRESH':'h-badge-fresh','UNLOCK':'h-badge-unlock','NEW_INST':'h-badge-inst'}[h.type]||'h-badge-whale';
            addrTd=`<td class="h-td h-td-addr"><div class="h-addr-two-line"><div class="h-addr-line1"><a href="${dbUrl}" target="_blank" rel="noopener noreferrer" class="h-addr-label">${h.label}</a><span class="h-badge ${bCls}">${h.type}</span></div><div class="h-addr-line2"><span class="h-addr-hex-sm">${shortA}</span>${copyButton}${dbIcon}</div></div></td>`;
        } else {
            addrTd=`<td class="h-td h-td-addr"><div class="h-addr-two-line"><div class="h-addr-line1"><a href="${dbUrl}" target="_blank" rel="noopener noreferrer" class="h-addr-hex">${shortA}</a>${copyButton}${dbIcon}</div></div></div></td>`;
        }
        let chainCells='';
        visChains.forEach(k=>{
            const bal=h.balances[k]||0;
            if(bal>0){
                const expUrl=CHAIN_EXPLORERS[k]+h.address;
                const chainUsd=bal*price;
                chainCells+=`<td class="h-td h-td-right"><a href="${expUrl}" target="_blank" rel="noopener noreferrer" style="color:${CHAIN_COLORS[k]};text-decoration:none;font-size:11px" title="${bal.toLocaleString('en-US')} ZRO on ${DATA.chains[k].name}">${fmt(bal)}</a><div class="h-usd-sub">${fmtUSD(chainUsd)}</div></td>`;
            } else {
                chainCells+=`<td class="h-td h-td-right"><span class="h-dash">—</span></td>`;
            }
        });
        const balCell=`<td class="h-td h-td-right" title="${dispBal.toLocaleString('en-US')} ZRO"><span class="h-bal-total">${fmt(dispBal)}</span><div class="h-usd-sub">${fmtUSD(usdVal)}</div></td>`;
        html+=`<tr class="h-row" ${clickableRowAttrs(dbUrl, 'Open wallet in DeBank')}><td class="h-td h-td-rank">${start+idx+1}</td>${addrTd}${chainCells}${balCell}</tr>`;
    });
    for(let i=page.length;i<HOLDERS_PER_PAGE;i++) html+=`<tr class="h-row-empty">${('<td class="h-td">&nbsp;</td>').repeat(colCount)}</tr>`;
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
let freshPage=1, freshSearchQuery='', freshSortKey='balance', freshSortDir='desc';
const FRESH_PER_PAGE=15;
function getFreshWallets(includeSearch=true) {
    let items = DATA.top_holders.filter(h => (h.type === 'FRESH' || h.fresh === true) && Object.values(h.balances).reduce((s,v)=>s+v,0) >= 10000);
    if(includeSearch && freshSearchQuery) {
        const q = freshSearchQuery.toLowerCase();
        items = items.filter(h => h.address.toLowerCase().includes(q) || (h.label||'').toLowerCase().includes(q));
    }
    items.sort((a,b) => {
        let aVal = 0, bVal = 0;
        if (freshSortKey === 'date') {
            aVal = a.wallet_created || 0;
            bVal = b.wallet_created || 0;
        } else if (freshSortKey === 'flow') {
            aVal = a.last_flow || 0;
            bVal = b.last_flow || 0;
        } else {
            aVal = Object.values(a.balances).reduce((s,v)=>s+v,0);
            bVal = Object.values(b.balances).reduce((s,v)=>s+v,0);
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
function renderFreshWallets() {
    let freshHolders = getFreshWallets();
    // Update sort indicators
    const dateTh = document.getElementById('fresh-sort-date');
    const flowTh = document.getElementById('fresh-sort-flow');
    const balTh = document.getElementById('fresh-sort-balance');
    if(dateTh) dateTh.textContent = sortLabel('Created', freshSortKey, 'date', freshSortDir);
    if(flowTh) flowTh.textContent = sortLabel('Last Flow', freshSortKey, 'flow', freshSortDir);
    if(balTh) balTh.textContent = sortLabel('Balance', freshSortKey, 'balance', freshSortDir);
    const allFresh = getFreshWallets(false);
    const totalSupply = DATA.total_supply || 1000000000;
    const price = DATA.meta?.price_usd || 0;
    const total = freshHolders.length;
    const totalPages = Math.max(1, Math.ceil(total / FRESH_PER_PAGE));
    freshPage = Math.min(freshPage, totalPages);
    const start = (freshPage - 1) * FRESH_PER_PAGE;
    const pageItems = freshHolders.slice(start, start + FRESH_PER_PAGE);
    let html = '';
    const maxPct = pageItems.length ? Math.max(...pageItems.map(h => Object.values(h.balances).reduce((s,v)=>s+v,0) / totalSupply * 100)) : 0.01;
    pageItems.forEach((h, i) => {
        const bal = Object.values(h.balances).reduce((s,v)=>s+v,0);
        const pct = (bal / totalSupply * 100).toFixed(4);
        const pctNum = bal / totalSupply * 100;
        const barW = Math.max(4, (pctNum / maxPct) * 100);
        const usdVal = price ? fmtUSD(bal * price) : '';
        const shortA = h.address.slice(0,6)+'…'+h.address.slice(-4);
        const dbUrl = `https://debank.com/profile/${h.address}`;
        const explorerUrl = `https://etherscan.io/address/${h.address}`;
        const dbIcon = debankIconHTML(dbUrl);
        const explorerIcon = explorerIconHTML(explorerUrl, `View ${shortA} on Etherscan`);
        const label = h.label || 'Fresh Wallet';
        const rank = start+i+1;
        const rankCls = rank <= 3 ? 'rank-badge top-3' : 'rank-badge';
        const fundedBy = h.funded_by ? `<span class="h-badge h-badge-funded" title="Funded by ${h.funded_by}">via ${h.funded_by}</span>` : '';
        const createdDate = h.wallet_created ? new Date(h.wallet_created * 1000).toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'}) : '—';
        const createdAge = h.wallet_created ? Math.floor((Date.now()/1000 - h.wallet_created) / 86400) + 'd ago' : '';
        const addrTd = `<div class="h-addr-two-line"><div class="h-addr-line1"><a href="${explorerUrl}" target="_blank" rel="noopener noreferrer" class="h-addr-label">${label}</a><span class="h-badge h-badge-fresh">FRESH</span>${fundedBy}</div><div class="h-addr-line2"><span class="h-addr-hex-sm">${shortA}</span>${copyButtonHTML(h.address)}${dbIcon}${explorerIcon}</div></div>`;
        const lastFlowDate = h.last_flow ? new Date(h.last_flow * 1000).toLocaleDateString('en-GB', {day:'numeric',month:'short'}) : '';
        const lastFlowAge = h.last_flow ? Math.floor((Date.now()/1000 - h.last_flow) / 86400) + 'd ago' : '';
        const lfAmt = h.last_flow_amount || 0;
        const lfSign = lfAmt >= 0 ? '+' : '';
        const lfColor = lfAmt >= 0 ? 'color:#4ade80' : 'color:#f87171';
        const lastFlowLine1 = lfAmt ? `<span style="${lfColor}">${lfSign}${fmt(lfAmt)} ZRO</span> · ${lastFlowDate}` : '—';
        html += `<tr>
            <td><span class="${rankCls}">${rank}</span></td>
            <td>${addrTd}</td>
            <td class="right"><div class="fresh-date">${createdDate}</div><div class="val-muted">${createdAge}</div></td>
            <td class="right"><div class="fresh-date">${lastFlowLine1}</div><div class="val-muted">${lastFlowAge}</div></td>
            <td class="right"><div class="bal-main">${fmt(bal)}<span class="bal-unit">ZRO</span></div>${usdVal?`<div class="h-usd-sub">${usdVal}</div>`:''}</td>
            <td class="right"><div class="supply-bar-wrap"><span class="val-muted">${pct}%</span><div class="supply-bar"><div class="supply-bar-fill" style="width:${barW}%"></div></div></div></td>
        </tr>`;
    });
    // Pad empty rows to keep constant height
    const emptyRows = FRESH_PER_PAGE - pageItems.length;
    for(let e=0;e<emptyRows;e++) html += '<tr class="h-row-empty"><td colspan="6"></td></tr>';
    if(!total && !freshSearchQuery) html = '<tr><td colspan="6"><div class="table-empty-state"><div class="empty-icon">🌱</div><div class="empty-text">No fresh wallets tracked</div></div></td></tr>';
    if(!total && freshSearchQuery) html = '<tr><td colspan="6"><div class="table-empty-state"><div class="empty-icon">🔍</div><div class="empty-text">No results for "'+freshSearchQuery+'"</div></div></td></tr>';
    document.getElementById('fresh-tbody').innerHTML = html;
    const totalBal = allFresh.reduce((s,h) => s + Object.values(h.balances).reduce((a,v)=>a+v,0), 0);
    const totalUsd = price ? fmtUSD(totalBal * price) : '—';
    const circSupply = DATA.meta?.circulating_supply || 252160000;
    const pctCirc = (totalBal / circSupply * 100).toFixed(2);
    document.getElementById('fresh-sub').textContent = `New wallets accumulating ZRO`;
    const statsEl = document.getElementById('fresh-stats');
    if(statsEl) statsEl.innerHTML = `
        <div class="fresh-stat"><div class="fresh-stat-val accent-white">${allFresh.length}</div><div class="fresh-stat-lbl">Fresh Wallets</div></div>
        <div class="fresh-stat"><div class="fresh-stat-val">${fmt(totalBal)} ZRO</div><div class="fresh-stat-lbl">Total Accumulated</div></div>
        <div class="fresh-stat"><div class="fresh-stat-val accent-cyan">${totalUsd}</div><div class="fresh-stat-lbl">USD Value</div></div>
        <div class="fresh-stat"><div class="fresh-stat-val">${pctCirc}%</div><div class="fresh-stat-lbl">of Circulating Supply</div></div>
    `;
    const countEl = document.getElementById('fresh-count');
    if(countEl) countEl.textContent = freshSearchQuery ? `${total} matching` : `${total} fresh wallets`;
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
    const nowSec = Math.floor(Date.now() / 1000);
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
        } else if (cbSortKey === 'flow') {
            aVal = a.cb_last_funded || 0;
            bVal = b.cb_last_funded || 0;
        } else {
            aVal = Object.values(a.balances).reduce((s,v)=>s+v,0);
            bVal = Object.values(b.balances).reduce((s,v)=>s+v,0);
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
    const totalSupply = DATA.total_supply || 1000000000;
    const price = DATA.meta?.price_usd || 0;
    const total = cbHolders.length;
    const totalPages = Math.max(1, Math.ceil(total / CB_PER_PAGE));
    cbPage = Math.min(cbPage, totalPages);
    const start = (cbPage - 1) * CB_PER_PAGE;
    const pageItems = cbHolders.slice(start, start + CB_PER_PAGE);
    let html = '';
    const maxPct = pageItems.length ? Math.max(...pageItems.map(h => Object.values(h.balances).reduce((s,v)=>s+v,0) / totalSupply * 100)) : 0.01;
    pageItems.forEach((h, i) => {
        const bal = Object.values(h.balances).reduce((s,v)=>s+v,0);
        const pct = (bal / totalSupply * 100).toFixed(4);
        const pctNum = bal / totalSupply * 100;
        const barW = Math.max(4, (pctNum / maxPct) * 100);
        const usdVal = price ? fmtUSD(bal * price) : '';
        const shortA = h.address.slice(0,6)+'…'+h.address.slice(-4);
        const dbUrl = `https://debank.com/profile/${h.address}`;
        const explorerUrl = `https://etherscan.io/address/${h.address}`;
        const dbIcon = debankIconHTML(dbUrl);
        const explorerIcon = explorerIconHTML(explorerUrl, `View ${shortA} on Etherscan`);
        const rank = start+i+1;
        const rankCls = rank <= 3 ? 'rank-badge top-3' : 'rank-badge';
        const fundedDate = h.cb_first_funded ? new Date(h.cb_first_funded * 1000).toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'}) : '—';
        const fundedAge = h.cb_first_funded ? Math.floor((Date.now()/1000 - h.cb_first_funded) / 86400) + 'd ago' : '';
        const addrTd = `<div class="h-addr-two-line"><div class="h-addr-line1"><a href="${explorerUrl}" target="_blank" rel="noopener noreferrer" class="h-addr-label">Coinbase Prime</a><span class="h-badge h-badge-inst">INST</span></div><div class="h-addr-line2"><span class="h-addr-hex-sm">${shortA}</span>${copyButtonHTML(h.address)}${dbIcon}${explorerIcon}</div></div>`;
        const lastFundedDate = h.cb_last_funded ? new Date(h.cb_last_funded * 1000).toLocaleDateString('en-GB', {day:'numeric',month:'short'}) : '';
        const lastFundedAge = h.cb_last_funded ? Math.floor((Date.now()/1000 - h.cb_last_funded) / 86400) + 'd ago' : '';
        const lastFlowAmt = h.cb_last_flow_amount || h.cb_total_received;
        const cbTotalRcv = lastFlowAmt ? `<span style="color:#4ade80">+${fmt(lastFlowAmt)} ZRO</span> · ${lastFundedDate}` : '—';
        html += `<tr>
            <td><span class="${rankCls}">${rank}</span></td>
            <td>${addrTd}</td>
            <td class="right"><div class="fresh-date">${fundedDate}</div><div class="val-muted">${fundedAge}</div></td>
            <td class="right"><div class="fresh-date">${cbTotalRcv}</div><div class="val-muted">${lastFundedAge}</div></td>
            <td class="right"><div class="bal-main">${fmt(bal)}<span class="bal-unit">ZRO</span></div>${usdVal?`<div class="h-usd-sub">${usdVal}</div>`:''}</td>
            <td class="right"><div class="supply-bar-wrap"><span class="val-muted">${pct}%</span><div class="supply-bar"><div class="supply-bar-fill" style="width:${barW}%"></div></div></div></td>
        </tr>`;
    });
    const emptyRows = CB_PER_PAGE - pageItems.length;
    for(let e=0;e<emptyRows;e++) html += '<tr class="h-row-empty"><td colspan="6"></td></tr>';
    if(!total && !cbSearchQuery) html = '<tr><td colspan="6"><div class="table-empty-state"><div class="empty-icon">🏦</div><div class="empty-text">No Coinbase Prime wallets in this period</div></div></td></tr>';
    if(!total && cbSearchQuery) html = '<tr><td colspan="6"><div class="table-empty-state"><div class="empty-icon">🔍</div><div class="empty-text">No results for "'+cbSearchQuery+'"</div></div></td></tr>';
    document.getElementById('cb-tbody').innerHTML = html;
    const totalBal = allCb.reduce((s,h) => s + Object.values(h.balances).reduce((a,v)=>a+v,0), 0);
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
let cbtPage=1, cbtTypeFilter='ALL', cbtPeriodDays=0, cbtSearchQuery='';
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

// ─── Fixed column config (user-set widths, locked) ───
const CBT_COLUMNS = [
    { id:'from', header:'From', width:280, align:'left', render: (t) => {
        const d = new Date(t.timestamp*1000);
        const ds = d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
        const ts = d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:false});
        const txShort = t.hash ? t.hash.slice(0,10)+'…' : '';
        return `<div class="cbt-from-cell">
            ${cbtAddrCell(t.from, t.from_label)}
            <div class="cbt-tx-meta">
                <a href="https://etherscan.io/tx/${t.hash}" target="_blank" rel="noopener" class="cbt-tx-link" title="${t.hash}">${txShort}</a>
                <span class="cbt-tx-date">${ds} ${ts}</span>
            </div>
        </div>`;
    }},
    { id:'to', header:'To', width:308, align:'left', render: (t) => cbtAddrCell(t.to, t.to_label) },
    { id:'type', header:'Type', width:241, align:'left', render: (t) => `<span style="color:${CBT_TYPE_COLORS[t.type]||'var(--text-primary)'};font-weight:600;font-size:12px">${CBT_TYPE_ICONS[t.type]||''} ${t.type}</span>` },
    { id:'amount', header:'Amount ⇅', width:177, align:'right', sortable:true, render: (t,p) => { const out=t.type==='SELL'||t.type==='OUTFLOW'; const c=out?'#FF4444':'#00D395'; const s=out?'-':'+'; const u=p?`<div class="h-usd-sub">${fmtUSD(t.value*p)}</div>`:''; return `<div style="color:${c};font-weight:600;font-variant-numeric:tabular-nums">${s}${fmt(t.value)} ZRO</div>${u}`; }},
];
let cbtSortDir = 0; // 0=date desc, 1=amount desc, 2=amount asc
function toggleCbtSort() { cbtSortDir = (cbtSortDir + 1) % 3; cbtPage = 1; requestHistoryMode('push'); renderCbTransfers(); }
function setCbtTypeTriggerLabel() {
    const trigger = document.getElementById('cbt-type-trigger');
    if (!trigger) return;
    const icon = CBT_TYPE_ICONS[cbtTypeFilter] || '';
    trigger.textContent = cbtTypeFilter === 'ALL' ? 'ALL ▾' : `${icon} ${cbtTypeFilter} ▾`;
}
function toggleCbtTypeDropdown() {
    const menu = document.getElementById('cbt-type-menu');
    const trigger = document.getElementById('cbt-type-trigger');
    if(!menu) return;
    const isOpen = menu.classList.toggle('open');
    trigger.classList.toggle('active', isOpen);
    trigger.setAttribute('aria-expanded', String(isOpen));
    if(isOpen) {
        const close = e => {
            if(!menu.contains(e.target) && e.target !== trigger) {
                menu.classList.remove('open');
                trigger.classList.remove('active');
                trigger.setAttribute('aria-expanded', 'false');
                document.removeEventListener('click', close);
            }
        };
        setTimeout(() => document.addEventListener('click', close), 0);
    }
}
function setCbtType(type) {
    cbtTypeFilter = type;
    const trigger = document.getElementById('cbt-type-trigger');
    setCbtTypeTriggerLabel();
    document.getElementById('cbt-type-menu').classList.remove('open');
    trigger.classList.remove('active');
    trigger.setAttribute('aria-expanded', 'false');
    cbtPage = 1;
    requestHistoryMode('push');
    renderCbTransfers();
}
function getFilteredCbtTransfers() {
    const txs = DATA.cb_prime_transfers || [];
    const nowSec = Math.floor(Date.now() / 1000);
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
    if(cbtSortDir === 1) filtered.sort((a,b) => b.value - a.value);
    else if(cbtSortDir === 2) filtered.sort((a,b) => a.value - b.value);
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
    tableEl.innerHTML = '';
    const cg = document.createElement('colgroup');
    cols.forEach(c => { const col = document.createElement('col'); col.style.width = c.width + 'px'; cg.appendChild(col); });
    tableEl.appendChild(cg);
    // thead
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    cols.forEach(c => {
        const th = document.createElement('th');
        if(c.align === 'right') th.classList.add('right');
        if(c.sortable) {
            const arrow = cbtSortDir === 0 ? '⇅' : cbtSortDir === 1 ? '↓' : '↑';
            const cls = cbtSortDir > 0 ? ' active' : '';
            th.innerHTML = `Amount <span class="sort-arrow${cls}">${arrow}</span>`;
            th.style.cursor = 'pointer';
            th.addEventListener('click', toggleCbtSort);
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
        cols.forEach(c => {
            const td = document.createElement('td');
            if(c.align === 'right') td.classList.add('right');
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
    const instHolders = DATA.top_holders.filter(h => h.type === 'NEW_INST' && Object.values(h.balances).reduce((s,v)=>s+v,0) >= 10000).sort((a,b) => {
        const aTotal = Object.values(a.balances).reduce((s,v)=>s+v,0);
        const bTotal = Object.values(b.balances).reduce((s,v)=>s+v,0);
        return bTotal - aTotal;
    });
    const totalSupply = DATA.total_supply || 1000000000;
    const total = instHolders.length;
    let html = '';
    instHolders.forEach((h, i) => {
        const bal = Object.values(h.balances).reduce((s,v)=>s+v,0);
        const pct = (bal / totalSupply * 100).toFixed(4);
        const short = h.address.slice(0,6)+'…'+h.address.slice(-4);
        const dbUrl = `https://debank.com/profile/${h.address}`;
        html += `<tr>
            <td class="rank-cell">${i+1}</td>
            <td><span class="h-addr-wrap"><a href="${dbUrl}" target="_blank" rel="noopener noreferrer" class="h-addr-hex">${short}</a><span class="h-badge h-badge-inst">NEW INST</span>${copyButtonHTML(h.address)}</span></td>
            <td class="right val-white" style="font-variant-numeric:tabular-nums">${fmt(bal)}</td>
            <td class="right val-muted" style="font-variant-numeric:tabular-nums">${pct}%</td>
            <td class="right" style="font-size:10px;color:var(--text-muted)">BitGo / Gnosis Safe</td>
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

let flowPageAcc=1, flowPageSell=1, flowChain='all', hideCex=false, flowSearchQuery='';
const CHAIN_ICONS_MAP={ethereum:'https://icons.llamao.fi/icons/chains/rsz_ethereum.jpg',arbitrum:'https://icons.llamao.fi/icons/chains/rsz_arbitrum.jpg',base:'https://icons.llamao.fi/icons/chains/rsz_base.jpg',bsc:'https://icons.llamao.fi/icons/chains/rsz_binance.jpg',optimism:'https://icons.llamao.fi/icons/chains/rsz_optimism.jpg',polygon:'https://icons.llamao.fi/icons/chains/rsz_polygon.jpg',avalanche:'https://icons.llamao.fi/icons/chains/rsz_avalanche.jpg'};

function getFlowItems(type){
    const flows=DATA.flows[currentPeriod]; if(!flows) return [];
    let items=flows[type]||[];
    const q=flowSearchQuery.trim().toLowerCase();
    if(q) items=items.filter(f=>f.address.toLowerCase().includes(q)||(f.label&&f.label.toLowerCase().includes(q)));
    if(flowChain!=='all'){
        const holders=DATA.top_holders;
        const addrSet=new Set(holders.filter(h=>(h.balances[flowChain]||0)>0).map(h=>h.address.toLowerCase()));
        items=items.filter(f=>addrSet.has(f.address.toLowerCase()));
    }
    if(hideCex){
        // Filter only type=CEX wallets (exchanges), NOT INST (investors like Coinbase Prime)
        const cexAddrs=new Set(DATA.top_holders.filter(h=>h.type==='CEX').map(h=>h.address.toLowerCase()));
        items=items.filter(f=>!cexAddrs.has(f.address.toLowerCase()));
    }
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
    ['accumulators','sellers'].forEach(type=>{
        const isAcc=type==='accumulators';
        const items=getFlowItems(type);
        const total=items.length;
        document.getElementById(isAcc?'acc-count':'sell-count').textContent=total.toLocaleString();
        const page=isAcc?flowPageAcc:flowPageSell;
        const totalPages=Math.max(1,Math.ceil(total/FLOW_PER_PAGE));
        const start=(page-1)*FLOW_PER_PAGE;
        const pageItems=items.slice(start,start+FLOW_PER_PAGE);
        let html='';
        pageItems.forEach((f,i)=>{
            const flowUsd=Math.abs(f.net_flow)*(DATA.meta.price_usd||0);
            const balUsd=(f.balance||0)*(DATA.meta.price_usd||0);
            html+=`<tr><td class="rank-cell">${start+i+1}</td><td>${addrCell(f)}</td><td class="right ${isAcc?'val-green':'val-red'}" style="font-variant-numeric:tabular-nums;font-weight:600">${isAcc?'+':''}${fmt(f.net_flow)}<div class="h-usd-sub">${fmtUSD(flowUsd)}</div></td><td class="right val-muted" style="font-variant-numeric:tabular-nums">${fmt(f.balance)}<div class="h-usd-sub">${fmtUSD(balUsd)}</div></td></tr>`;
        });
        for(let i=pageItems.length;i<FLOW_PER_PAGE;i++) html+=`<tr class="empty-row">${'<td>&nbsp;</td>'.repeat(4)}</tr>`;
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
    document.getElementById('chain-dd-menu').classList.remove('open');
    const trigger = document.getElementById('chain-dd-trigger');
    trigger.classList.toggle('active', chain !== 'all');
    trigger.setAttribute('aria-expanded', 'false');
    requestHistoryMode('push');
    renderFlows();
}
function toggleChainDropdown() {
    const menu = document.getElementById('chain-dd-menu');
    const trigger = document.getElementById('chain-dd-trigger');
    const isOpen = menu.classList.toggle('open');
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
    // Click outside to close
    document.addEventListener('click', (e) => {
        const dd = document.getElementById('chain-dropdown');
        if (dd && !dd.contains(e.target)) {
            document.getElementById('chain-dd-menu').classList.remove('open');
            const trigger = document.getElementById('chain-dd-trigger');
            if (flowChain === 'all') trigger.classList.remove('active');
            trigger.setAttribute('aria-expanded', 'false');
        }
    });
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
        <td style="font-weight:600;color:var(--text-primary)">${inv.round}</td>
        <td style="color:var(--text-muted);font-size:11px">${inv.date}</td>
        <td style="font-variant-numeric:tabular-nums">${inv.raised?fmtUSD(inv.raised):'<span style="color:var(--text-muted)">Undisclosed</span>'}</td>
        <td style="font-variant-numeric:tabular-nums">${inv.price_est?'$'+inv.price_est.toFixed(2):'<span style="color:var(--text-muted)">—</span>'}</td>
        <td style="font-weight:600;${inv.roi&&parseFloat(inv.roi)>1?'color:var(--accent-green)':inv.roi&&parseFloat(inv.roi)<1?'color:var(--accent-rose)':'color:var(--text-muted)'}">${inv.roi||'—'}</td>
        <td><span class="${riskMap[inv.risk]||''}" style="font-size:11px">${riskLabel[inv.risk]||inv.risk}</span></td>
        <td style="font-size:10px;color:var(--text-muted);line-height:1.4">${inv.investors}</td>
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
    const gen = new Date(DATA.meta.generated);
    const now = new Date();
    const diff = Math.floor((now - gen) / 1000);
    let ago;
    if(diff < 60) ago = 'just now';
    else if(diff < 3600) ago = Math.floor(diff/60) + ' min ago';
    else if(diff < 86400) ago = Math.floor(diff/3600) + 'h ' + Math.floor((diff%3600)/60) + 'min ago';
    else ago = Math.floor(diff/86400) + 'd ago';
    const status = diff < 7200 ? 'fresh' : diff < 86400 ? 'delayed' : 'historical';
    const statusIcon = status === 'fresh' ? '🟢' : status === 'delayed' ? '🟡' : '🟠';
    const statusColor = status === 'fresh' ? 'var(--accent-green)' : status === 'delayed' ? 'var(--accent-amber)' : 'var(--accent-orange)';
    const chipLabel = status === 'fresh' ? 'Fresh Snapshot' : status === 'delayed' ? 'Delayed Snapshot' : 'Historical Snapshot';
    const absolute = gen.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    if (footerEl) {
        footerEl.innerHTML = `<span style="color:${statusColor}">${statusIcon}</span> Snapshot Updated ${ago} <span style="color:var(--text-muted);font-size:11px">(${absolute})</span>`;
    }
    if (bannerEl) {
        const title = status === 'fresh'
            ? `Indexed on-chain tables were refreshed ${ago}.`
            : status === 'delayed'
                ? `Indexed on-chain tables are slightly delayed and were refreshed ${ago}.`
                : `On-chain tables currently reflect an older indexed snapshot from ${absolute}.`;
        const detail = status === 'fresh'
            ? 'Token price refreshes live from CoinGecko, and the rest of the dashboard is aligned with a recent indexed dataset.'
            : status === 'delayed'
                ? 'Token price refreshes live from CoinGecko, while holder tables, flows and whale activity use the latest indexed dataset available locally.'
                : 'Token price still refreshes live from CoinGecko, but holder tables, flows and whale activity stay tied to the last indexed dataset until zro_data.json is regenerated.';
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
}

// ── Whale Transfers ──
let whalePageNum = 1;
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
    // 1. Known CEX addresses (highest priority)
    for (const [addr, name] of Object.entries(KNOWN_CEX_LABELS)) map[addr.toLowerCase()] = name;
    // 2. Labels from top_holders
    for (const h of DATA.top_holders) {
        if (h.label) map[h.address.toLowerCase()] = h.label;
    }
    return map;
}
function renderWhaleTransfers() {
    const transfers = (DATA.whale_transfers || []).slice().sort((a, b) => b.timestamp - a.timestamp);
    const card = document.getElementById('whale-card');
    if (!card) return;
    if (!transfers.length) { card.style.display = 'none'; return; }
    card.style.display = '';
    const labelMap = buildWhaleLabelMap();
    const total = transfers.length;
    const totalPages = Math.max(1, Math.ceil(total / WHALE_PER_PAGE));
    whalePageNum = Math.min(whalePageNum, totalPages);
    const start = (whalePageNum - 1) * WHALE_PER_PAGE;
    const pageItems = transfers.slice(start, start + WHALE_PER_PAGE);
    const price = DATA.meta.price_usd || 0;
    let html = '';
    pageItems.forEach(t => {
        const date = new Date(t.timestamp * 1000);
        const timeStr = date.toLocaleDateString('en-GB', {day:'numeric',month:'short'}) + ' ' + date.toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'});
        const ago = Math.floor((Date.now()/1000 - t.timestamp) / 86400);
        const agoStr = ago === 0 ? 'today' : ago + 'd ago';
        const typeCls = t.type === 'CEX_WITHDRAWAL' ? 'h-badge-fresh' : t.type === 'CEX_DEPOSIT' ? 'h-badge-sell' : 'h-badge-inst';
        const typeLabel = t.type === 'CEX_WITHDRAWAL' ? '🟢 BUY' : t.type === 'CEX_DEPOSIT' ? '🔴 SELL' : '🔄 MOVE';
        const fromResolved = labelMap[t.from.toLowerCase()] || t.from_label;
        const toResolved = labelMap[t.to.toLowerCase()] || t.to_label;
        const fromShort = fromResolved || (t.from.slice(0,6) + '…' + t.from.slice(-4));
        const toShort = toResolved || (t.to.slice(0,6) + '…' + t.to.slice(-4));
        const fromLink = `<a href="https://etherscan.io/address/${t.from}" target="_blank" rel="noopener noreferrer" class="h-addr-hex-sm">${fromShort}</a>`;
        const toLink = `<a href="https://etherscan.io/address/${t.to}" target="_blank" rel="noopener noreferrer" class="h-addr-hex-sm">${toShort}</a>`;
        const usdVal = price ? fmtUSD(t.value * price) : '';
        const amtColor = t.type === 'CEX_DEPOSIT' ? 'color:#f87171' : 'color:#4ade80';
        const amtSign = t.type === 'CEX_DEPOSIT' ? '-' : '+';
        html += `<tr ${clickableRowAttrs(`https://etherscan.io/tx/${t.tx_hash}`, 'Open whale transfer transaction')} style="cursor:pointer">
            <td><div class="fresh-date">${timeStr}</div><div class="val-muted">${agoStr}</div></td>
            <td><span class="h-badge ${typeCls}">${typeLabel}</span></td>
            <td>${fromLink}</td>
            <td>${toLink}</td>
            <td class="right" style="${amtColor};font-weight:600">${amtSign}${fmt(t.value)} ZRO${usdVal ? `<div class="h-usd-sub">${usdVal}</div>` : ''}</td>
        </tr>`;
    });
    document.getElementById('whale-tbody').innerHTML = html;
    document.getElementById('whale-sub').textContent = `${total} large transfers tracked`;
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
    try { DATA=await(await fetch('zro_data.json?v=' + new Date().getTime())).json(); }
    catch(e) { document.querySelector('.page-wrapper').innerHTML='<div style="text-align:center;padding:80px;color:var(--text-muted)"><h2 style="color:var(--accent-rose)">Failed to load data</h2></div>'; return; }
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
}
document.addEventListener('DOMContentLoaded', init);
