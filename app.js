/* ZRO Analytics Dashboard — app.js */
let DATA = null, currentPeriod = '30d', holdersPage = 1;
const HOLDERS_PER_PAGE = 10, FLOW_PER_PAGE = 5;
let holdersSortKey = 'total', holdersSortDir = 'desc', holdersSearchQuery = '';

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
function copyText(t) { navigator.clipboard.writeText(t).then(()=>showToast('Copied: '+shortAddr(t))); }
function showToast(m) { const t=document.getElementById('toast'); t.textContent=m; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2000); }

function badgeHTML(type) {
    const m={'CEX':'badge-cex','DEX':'badge-dex','PROTOCOL':'badge-protocol','VC':'badge-vc','INST':'badge-inst','WALLET':'badge-wallet'};
    return `<span class="addr-badge ${m[type]||'badge-wallet'}">${type}</span>`;
}
function addrCell(item) {
    const addr=item.address, debankUrl=`https://debank.com/profile/${addr}`;
    const icons=`<button class="icon-btn" onclick="event.stopPropagation();copyText('${addr}')" title="Copy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button><a class="icon-btn" href="${debankUrl}" target="_blank" rel="noopener" title="DeBank" onclick="event.stopPropagation()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>`;
    if (item.label) return `<div style="line-height:1.3"><div class="addr-primary">${item.label} ${badgeHTML(item.type)}</div><div class="addr-hex">${shortAddr(addr)} ${icons}</div></div>`;
    return `<div style="line-height:1.3"><div class="addr-hex" style="color:rgba(255,255,255,0.7);font-size:12px">${shortAddr(addr)} ${badgeHTML(item.type)} ${icons}</div></div>`;
}

// ── Tabs ──
function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelector('.tab-btn.active').classList.remove('active');
            btn.classList.add('active');
            document.querySelectorAll('.tab-view').forEach(v => v.classList.remove('active'));
            document.getElementById('view-'+btn.dataset.tab).classList.add('active');
        });
    });
}

// ── Price + Circulating Supply (live from CoinGecko) ──
async function fetchPrice() {
    try {
        const r=await fetch('https://api.coingecko.com/api/v3/coins/layerzero?localization=false&tickers=false&community_data=false&developer_data=false');
        const j=await r.json();
        if (j.market_data) {
            const md=j.market_data;
            DATA.meta.price_usd=md.current_price.usd;
            DATA.meta.circulating_supply=md.circulating_supply||DATA.meta.circulating_supply;
            DATA.meta.market_cap=md.market_cap.usd||DATA.meta.market_cap;
            DATA.meta.fdv=md.fully_diluted_valuation.usd||DATA.meta.fdv;
            renderMetrics();
            const ch=md.price_change_percentage_24h;
            document.getElementById('m-price-src').innerHTML=`via CoinGecko · <span style="color:${ch>=0?'var(--accent-green)':'var(--accent-rose)'}">${ch>=0?'+':''}${ch.toFixed(2)}% 24h</span>`;
        }
    } catch(e) { console.warn('CoinGecko failed',e); }
}

function renderMetrics() {
    const m=DATA.meta;
    document.getElementById('m-circ').textContent=fmt(m.circulating_supply);
    document.getElementById('m-circ-pct').textContent=((m.circulating_supply/m.total_supply)*100).toFixed(1)+'% of total';
    document.getElementById('m-price').textContent='$'+m.price_usd.toFixed(2);
    document.getElementById('m-mcap').textContent=fmtUSD(m.market_cap);
    document.getElementById('m-fdv').textContent=fmtUSD(m.fdv);
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
        return `<div class="chain-bar-row" onclick="window.open('${c.explorer}','_blank')"><div class="chain-bar-label"><span class="chain-dot" style="background:${c.color}"></span>${c.short}</div><div class="chain-bar-track"><div class="chain-bar-fill" style="width:${pct}%;background:${c.color}">${sPct}%</div></div><div class="chain-bar-value">${fmt(c.supply)}</div></div>`;
    }).join('');
    document.getElementById('chain-stats').innerHTML=`
        <div style="text-align:center;padding:16px 0 12px">
            <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Total Holders (7 chains)</div>
            <div style="font-size:32px;font-weight:800;color:var(--accent-cyan);font-variant-numeric:tabular-nums">${totalHolders.toLocaleString()}</div>
        </div>
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

// ── Hodlers with chain toggles ──
const CHAIN_KEYS = ['ethereum','arbitrum','base','bsc','optimism','polygon','avalanche'];
let activeChains = new Set(['ethereum']); // start with ETH active
function initChainToggles() {
    const el=document.getElementById('chain-toggles');
    el.innerHTML=CHAIN_KEYS.map(k=>{
        const c=DATA.chains[k];
        return `<button class="chain-toggle ${activeChains.has(k)?'active':''}" data-chain="${k}" style="--toggle-color:${c.color}" onclick="toggleChain('${k}')"><span class="toggle-dot"></span>${c.short}</button>`;
    }).join('');
}
function toggleChain(k) {
    if(activeChains.has(k)) { if(activeChains.size>1) activeChains.delete(k); }
    else activeChains.add(k);
    document.querySelectorAll('.chain-toggle').forEach(b=>b.classList.toggle('active',activeChains.has(b.dataset.chain)));
    holdersPage=1; renderHolders();
}
function getFilteredHolders() {
    let items=[...DATA.top_holders];
    if (holdersSearchQuery) { const q=holdersSearchQuery.toLowerCase(); items=items.filter(h=>h.address.toLowerCase().includes(q)||(h.label&&h.label.toLowerCase().includes(q))); }
    items.sort((a,b)=>{ if(holdersSortKey==='address'){const va=(a.label||a.address).toLowerCase(),vb=(b.label||b.address).toLowerCase();return holdersSortDir==='asc'?va.localeCompare(vb):vb.localeCompare(va);} const va=holdersSortKey==='total'?a.total:(a.balances[holdersSortKey]||0),vb=holdersSortKey==='total'?b.total:(b.balances[holdersSortKey]||0); return holdersSortDir==='asc'?va-vb:vb-va; });
    return items;
}
function renderHolders() {
    const chains=[...activeChains];
    // Build thead
    let thead=`<tr><th style="width:32px">#</th><th onclick="sortHolders('address')">Address <span class="sort-arrow">⇅</span></th>`;
    chains.forEach(k=>{ const c=DATA.chains[k]; thead+=`<th class="right" onclick="sortHolders('${k}')" style="color:${c.color};min-width:80px">${c.short} <span class="sort-arrow${holdersSortKey===k?' active':''}">⇅</span></th>`; });
    thead+=`<th class="right" onclick="sortHolders('total')" style="color:#fff;min-width:80px">ALL <span class="sort-arrow${holdersSortKey==='total'?' active':''}">▼</span></th></tr>`;
    document.getElementById('holders-thead').innerHTML=thead;
    const colCount=2+chains.length+1;
    // Build tbody
    const items=getFilteredHolders(), totalPages=Math.max(1,Math.ceil(items.length/HOLDERS_PER_PAGE));
    if(holdersPage>totalPages) holdersPage=totalPages;
    const start=(holdersPage-1)*HOLDERS_PER_PAGE, page=items.slice(start,start+HOLDERS_PER_PAGE);
    document.getElementById('holders-count').textContent=items.length+' hodlers';
    let html='';
    page.forEach((h,i)=>{
        html+=`<tr><td class="rank-cell">${start+i+1}</td><td>${addrCell(h)}</td>`;
        chains.forEach(k=>{ const bal=h.balances[k]||0; html+=`<td class="right" style="font-variant-numeric:tabular-nums;font-size:11px;color:${bal?'rgba(255,255,255,0.7)':'rgba(255,255,255,0.12)'}">${bal?fmt(bal):'—'}</td>`; });
        html+=`<td class="right val-white" style="font-variant-numeric:tabular-nums">${fmt(h.total)}</td></tr>`;
    });
    for(let i=page.length;i<HOLDERS_PER_PAGE;i++) html+=`<tr class="empty-row">${('<td>&nbsp;</td>').repeat(colCount)}</tr>`;
    document.getElementById('holders-tbody').innerHTML=html;
    document.getElementById('holders-pager').innerHTML=`<button onclick="holdersPage=1;renderHolders()" ${holdersPage<=1?'disabled':''}>«</button><button onclick="holdersPage--;renderHolders()" ${holdersPage<=1?'disabled':''}>‹</button><span>${holdersPage} / ${totalPages}</span><button onclick="holdersPage++;renderHolders()" ${holdersPage>=totalPages?'disabled':''}>›</button><button onclick="holdersPage=${totalPages};renderHolders()" ${holdersPage>=totalPages?'disabled':''}>»</button>`;
}
function sortHolders(k) { if(holdersSortKey===k) holdersSortDir=holdersSortDir==='asc'?'desc':'asc'; else {holdersSortKey=k;holdersSortDir='desc';} holdersPage=1;renderHolders(); }
function filterHolders() { holdersSearchQuery=document.getElementById('holders-search').value.trim();holdersPage=1;renderHolders(); }

// ── Flows ──
function renderFlows() {
    const flows=DATA.flows[currentPeriod]; if(!flows)return;
    const q=(document.getElementById('flow-search').value||'').trim().toLowerCase();
    ['accumulators','sellers'].forEach(type=>{
        const isAcc=type==='accumulators'; let items=flows[type]||[];
        if(q) items=items.filter(f=>f.address.toLowerCase().includes(q)||(f.label&&f.label.toLowerCase().includes(q)));
        document.getElementById(isAcc?'acc-count':'sell-count').textContent=items.length;
        let html='';
        items.slice(0,FLOW_PER_PAGE).forEach((f,i)=>{
            html+=`<tr><td class="rank-cell">${i+1}</td><td>${addrCell(f)}</td><td class="right ${isAcc?'val-green':'val-red'}" style="font-variant-numeric:tabular-nums;font-weight:600">${isAcc?'+':''}${fmt(f.net_flow)}</td><td class="right val-muted" style="font-variant-numeric:tabular-nums">${fmt(f.balance)}</td></tr>`;
        });
        for(let i=items.length;i<FLOW_PER_PAGE;i++) html+=`<tr class="empty-row">${'<td>&nbsp;</td>'.repeat(4)}</tr>`;
        document.getElementById(isAcc?'acc-tbody':'sell-tbody').innerHTML=html;
    });
}
function filterFlows() { renderFlows(); }
function initPeriodPills() {
    document.getElementById('flow-period-pills').querySelectorAll('button').forEach(b=>{
        b.addEventListener('click',()=>{ document.querySelector('#flow-period-pills .active').classList.remove('active'); b.classList.add('active'); currentPeriod=b.dataset.period; renderFlows(); });
    });
}

// ── Tokenomics ──
function renderAllocation() {
    const a=DATA.allocation, el=document.getElementById('alloc-section');
    let html='<div class="alloc-bars">';
    Object.values(a).forEach(cat=>{
        const unlockedPct=(cat.unlocked/cat.tokens*100).toFixed(0);
        html+=`<div class="alloc-row"><div class="alloc-color" style="background:${cat.color}"></div><div class="alloc-info"><div class="alloc-name">${cat.label}</div><div class="alloc-detail">${fmt(cat.tokens)} ZRO · ${unlockedPct}% unlocked (${fmt(cat.unlocked)})${cat.monthly_unlock?' · '+fmt(cat.monthly_unlock)+'/mo':''}</div></div><div class="alloc-pct" style="color:${cat.color}">${cat.pct}%</div></div>`;
    });
    html+='</div><div class="alloc-donut" style="flex-direction:column;gap:12px">';
    Object.values(a).forEach(cat=>{
        html+=`<div style="display:flex;align-items:center;gap:8px;width:100%"><div class="alloc-color" style="background:${cat.color}"></div><span style="font-size:11px;color:var(--text-secondary);flex:1">${cat.label}</span><div class="alloc-bar-track" style="flex:2"><div class="alloc-bar-fill" style="width:${cat.pct/38.3*100}%;background:${cat.color}"></div></div></div>`;
    });
    html+='</div>';
    el.innerHTML=html;
}

function renderVesting() {
    const v=DATA.vesting, el=document.getElementById('vesting-section');
    const now=new Date(), start=new Date(v.cliff_end), end=new Date(v.vesting_end);
    const totalMs=end-start, elapsedMs=now-start, pct=Math.min(100,Math.max(0,(elapsedMs/totalMs)*100));
    const monthsLeft=Math.max(0,Math.ceil((end-now)/(30*24*60*60*1000)));
    el.innerHTML=`
        <div class="vest-progress"><div style="font-size:12px;color:var(--text-secondary);margin-bottom:4px">Vesting Progress · ${pct.toFixed(1)}% elapsed</div>
        <div class="vest-bar-track"><div class="vest-bar-fill" style="width:${pct}%"></div></div>
        <div class="vest-labels"><span>Cliff End: Jun 2025</span><span>Now</span><span>Vesting End: Jun 2027</span></div></div>
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

// ── Init ──
async function init() {
    try { DATA=await(await fetch('zro_data.json')).json(); }
    catch(e) { document.querySelector('.page-wrapper').innerHTML='<div style="text-align:center;padding:80px;color:var(--text-muted)"><h2 style="color:var(--accent-rose)">Failed to load data</h2></div>'; return; }
    renderMetrics(); renderNetworkStats(); renderChains(); initChainToggles(); renderHolders(); renderFlows();
    renderAllocation(); renderVesting(); renderBuybacks(); renderInvestors(); renderValueStreams(); renderTimeline();
    initTabs(); initPeriodPills();
    document.getElementById('footer-updated').textContent='Last updated: '+new Date(DATA.meta.generated).toLocaleString();
    fetchPrice(); setInterval(fetchPrice,60000);
}
document.addEventListener('DOMContentLoaded', init);
