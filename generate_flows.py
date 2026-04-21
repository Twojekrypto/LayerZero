#!/usr/bin/env python3
"""
Generate real ZRO flow data from on-chain transfers (multi-chain).
Supports INCREMENTAL SCANNING — on subsequent runs, only fetches new
transfers since the last scanned block, dramatically reducing run time.

Cache file: flow_cache.json (stores per-chain last_block + all transfers)
First run: ~15-20 min (full 365d scan)
Subsequent runs: ~2-3 min (incremental from last block)
"""
import json, os, time
from urllib.request import urlopen, Request
from collections import defaultdict
from cex_addresses import KNOWN_CEX_ADDRESSES
from utils import atomic_json_dump, fetch_json, get_api_key

API_KEY = get_api_key()
ZRO_CONTRACT = "0x6985884c4392d348587b19cb9eaaf157f13271cd"
DECIMALS = 18

DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(DIR, "zro_data.json")
CACHE_PATH = os.path.join(DIR, "flow_cache.json")

# Chain configs: chain_id, block_time (s), top_n wallets to scan
CHAINS = {
    "ethereum":  {"id": 1,     "block_time": 12,  "top_n": 600},
    "arbitrum":  {"id": 42161, "block_time": 0.25, "top_n": 100},
    "base":      {"id": 8453,  "block_time": 2,    "top_n": 50},
    "bsc":       {"id": 56,    "block_time": 3,    "top_n": 50},
    "optimism":  {"id": 10,    "block_time": 2,    "top_n": 50},
    "polygon":   {"id": 137,   "block_time": 2,    "top_n": 50},
    "avalanche": {"id": 43114, "block_time": 2,    "top_n": 50},
}

# Period definitions in seconds
PERIODS = {
    "1d":   1 * 86400,
    "7d":   7 * 86400,
    "30d":  30 * 86400,
    "90d":  90 * 86400,
    "180d": 180 * 86400,
    "all":  365 * 5 * 86400,
}

# How far back to scan on a FULL (first) run
FULL_SCAN_DAYS = 365
FLOW_INFRA_TYPES = {"CEX", "DEX", "PROTOCOL", "TEAM", "MULTISIG", "CUSTODY", "MM", "UNLOCK"}
FLOW_MIN_RETENTION = 0.25
FLOW_MIN_BALANCE = 1_000
FLOW_MIN_NET_RETENTION = 0.10
FLOW_MIN_BALANCE_SHARE = 0.01
FLOW_MIN_SELL_BALANCE_SHARE = 0.005
FLOW_COHORT_LABELS = {
    "organic": "Organic",
    "strategic": "Strategic / VC",
    "coinbase": "Coinbase / Custody",
}
ACCUMULATION_SOURCE_LABELS = {
    "coinbase_funded": "Coinbase funded",
    "cex_funded": "CEX funded",
    "strategic_inflow": "Strategic inflow",
    "holder_built": "Holder-built",
    "external_inflow": "External inflow",
    "mixed_inflow": "Mixed inflow",
    "unresolved_inflow": "Unresolved inflow",
}
SELLER_PROFILE_LABELS = {
    "coinbase_outflow": "Coinbase outflow",
    "cex_outflow": "CEX outflow",
    "strategic_rotation": "Strategic rotation",
    "holder_redistribution": "Holder redistribution",
    "external_outflow": "External outflow",
    "mixed_outflow": "Mixed outflow",
    "coinbase_rotation": "Coinbase / custody rotation",
    "unresolved_outflow": "Unresolved outflow",
}
FRESH_FLOW_LABELS = {
    "fresh_whale_accumulator": "Fresh whale",
    "fresh_accumulator": "Fresh accumulator",
    "fresh_wallet": "Fresh wallet",
    "fresh_seller": "Fresh seller",
}
STRATEGIC_FLOW_TYPES = {"VC", "TEAM", "UNLOCK", "INST"}




def get_zro_transfers(address, chain_name, chain_id, start_block=0):
    """Fetch ZRO token transfers for an address on a specific chain."""
    transfers = []
    page = 1

    while True:
        url = (
            f"https://api.etherscan.io/v2/api?chainid={chain_id}"
            f"&module=account&action=tokentx"
            f"&address={address}"
            f"&contractaddress={ZRO_CONTRACT}"
            f"&startblock={start_block}&endblock=99999999"
            f"&page={page}&offset=1000&sort=desc"
            f"&apikey={API_KEY}"
        )
        data = fetch_json(url)

        if not data or data.get("status") != "1" or not data.get("result"):
            break

        results = data["result"]
        for tx in results:
            transfers.append({
                "hash": tx.get("hash", ""),
                "from": tx.get("from", "").lower(),
                "to": tx.get("to", "").lower(),
                "value": int(tx.get("value", "0")) / (10 ** DECIMALS),
                "timestamp": int(tx.get("timeStamp", "0")),
                "chain": chain_name,
            })

        if len(results) < 1000:
            break

        page += 1
        time.sleep(0.22)

    return transfers


def get_current_block(chain_id):
    """Get current block number for a chain."""
    url = (
        f"https://api.etherscan.io/v2/api?chainid={chain_id}"
        f"&module=proxy&action=eth_blockNumber"
        f"&apikey={API_KEY}"
    )
    data = fetch_json(url)
    if data and data.get("result"):
        try:
            return int(data["result"], 16)
        except (ValueError, TypeError):
            # Free API may not support this chain
            print(f"   ⚠️ Chain {chain_id}: {str(data['result'])[:80]}")
            return 0
    return 0


def load_cache():
    """Load transfer cache from disk."""
    if os.path.exists(CACHE_PATH):
        try:
            with open(CACHE_PATH) as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return {"last_blocks": {}, "transfers": {}}


def save_cache(cache):
    """Save transfer cache to disk."""
    atomic_json_dump(cache, CACHE_PATH, indent=None)


def prune_old_transfers(cache, cutoff_ts):
    """Remove transfers older than cutoff timestamp."""
    pruned = 0
    for addr in list(cache["transfers"].keys()):
        txs = cache["transfers"][addr]
        filtered = [t for t in txs if t["timestamp"] >= cutoff_ts]
        pruned += len(txs) - len(filtered)
        if filtered:
            cache["transfers"][addr] = filtered
        else:
            del cache["transfers"][addr]
    return pruned


def derive_flow_cohort(holder_meta):
    label = (holder_meta.get("label") or "").lower()
    flow_type = (holder_meta.get("type") or "").upper()
    if "coinbase" in label:
        return "coinbase"
    if flow_type in STRATEGIC_FLOW_TYPES:
        return "strategic"
    if any(token in label for token in ("investment recipient", "borderless capital", "strategic")):
        return "strategic"
    return "organic"


def classify_outbound_counterparty(counterparty, holder_meta_map):
    counterparty = (counterparty or "").lower()
    if not counterparty:
        return "unknown"
    cex_name = KNOWN_CEX_ADDRESSES.get(counterparty)
    if cex_name:
        return "coinbase" if "coinbase" in cex_name.lower() else "cex"
    holder_meta = holder_meta_map.get(counterparty)
    if not holder_meta:
        return "unknown"
    cohort = derive_flow_cohort(holder_meta)
    if cohort == "coinbase":
        return "coinbase"
    if cohort == "strategic":
        return "strategic"
    return "holder"


def classify_inbound_counterparty(counterparty, holder_meta_map):
    return classify_outbound_counterparty(counterparty, holder_meta_map)


def derive_accumulation_source(inbound_buckets, holder_meta):
    total_in = sum(inbound_buckets.values())
    if total_in <= 0:
        cohort = derive_flow_cohort(holder_meta)
        if cohort == "coinbase":
            return "coinbase_funded"
        if cohort == "strategic":
            return "strategic_inflow"
        return "unresolved_inflow"

    bucket_shares = {bucket: value / total_in for bucket, value in inbound_buckets.items() if value > 0}
    if not bucket_shares:
        return "unresolved_inflow"

    dominant_bucket, dominant_share = max(bucket_shares.items(), key=lambda item: item[1])
    cex_share = bucket_shares.get("cex", 0) + bucket_shares.get("coinbase", 0)
    if bucket_shares.get("coinbase", 0) >= 0.45:
        return "coinbase_funded"
    if cex_share >= 0.6 or (dominant_bucket == "cex" and dominant_share >= 0.45):
        return "cex_funded"
    if dominant_bucket == "strategic" and dominant_share >= 0.5:
        return "strategic_inflow"
    if dominant_bucket == "holder" and dominant_share >= 0.5:
        return "holder_built"
    if dominant_bucket == "unknown" and dominant_share >= 0.65:
        return "external_inflow"
    return "mixed_inflow"


def derive_seller_profile(outbound_buckets, holder_meta):
    total_out = sum(outbound_buckets.values())
    if total_out <= 0:
        cohort = derive_flow_cohort(holder_meta)
        if cohort == "coinbase":
            return "coinbase_rotation"
        if cohort == "strategic":
            return "strategic_rotation"
        return "unresolved_outflow"

    bucket_shares = {bucket: value / total_out for bucket, value in outbound_buckets.items() if value > 0}
    if not bucket_shares:
        return "unresolved_outflow"

    dominant_bucket, dominant_share = max(bucket_shares.items(), key=lambda item: item[1])
    cex_share = bucket_shares.get("cex", 0) + bucket_shares.get("coinbase", 0)
    if bucket_shares.get("coinbase", 0) >= 0.45:
        return "coinbase_outflow"
    if cex_share >= 0.6 or dominant_bucket == "cex" and dominant_share >= 0.45:
        return "cex_outflow"
    if dominant_bucket == "strategic" and dominant_share >= 0.5:
        return "strategic_rotation"
    if dominant_bucket == "holder" and dominant_share >= 0.5:
        return "holder_redistribution"
    if dominant_bucket == "unknown" and dominant_share >= 0.65:
        return "external_outflow"
    return "mixed_outflow"


def derive_fresh_flow_signal(holder_meta, net_flow):
    is_fresh = holder_meta.get("type") == "FRESH" or holder_meta.get("label") == "Fresh Wallet" or holder_meta.get("fresh") is True
    if not is_fresh:
        return ""
    if net_flow < 0:
        return "fresh_seller"
    fresh_signal = holder_meta.get("fresh_signal") or ""
    if fresh_signal in {"fresh_whale_accumulator", "fresh_accumulator"}:
        return fresh_signal
    return "fresh_wallet"


def derive_sell_pressure_score(item):
    balance = item.get("balance", 0) or 0
    balance_share = abs(item["net_flow"]) / balance if balance > 0 else 0
    cex_ratio = item.get("cex_outflow_ratio", 0) or 0
    external_ratio = item.get("external_outflow_ratio", 0) or 0
    pressure = 1 + (min(balance_share, 0.25) * 4.0) + (min(cex_ratio, 1) * 0.9) + (min(external_ratio, 1) * 0.35)
    seller_profile = item.get("seller_profile", "")
    if seller_profile == "coinbase_outflow":
        pressure += 0.55
    elif seller_profile == "cex_outflow":
        pressure += 0.45
    elif seller_profile == "mixed_outflow":
        pressure += 0.2
    elif seller_profile == "holder_redistribution":
        pressure = max(0.8, pressure - 0.1)
    elif seller_profile == "strategic_rotation":
        pressure = max(0.75, pressure - 0.15)
    if item.get("fresh_flow_signal") == "fresh_seller":
        pressure += 0.08
    return round(abs(item["net_flow"]) * pressure, 2)


def derive_flow_score(item):
    balance = item.get("balance", 0) or 0
    balance_share = abs(item["net_flow"]) / balance if balance > 0 else 0
    if item["net_flow"] > 0:
        retention = max(0, min(item.get("retention_ratio", 0) or 0, 2))
        net_retention = max(0, min(get_net_retention_ratio(item), 1.5))
        conviction = 1 + (retention * 0.35) + (net_retention * 0.55) + (min(balance_share, 0.25) * 2.5)
        fresh_signal = item.get("fresh_flow_signal", "")
        accumulation_source = item.get("accumulation_source", "")
        if fresh_signal == "fresh_whale_accumulator":
            conviction += 0.25
        elif fresh_signal == "fresh_accumulator":
            conviction += 0.18
        elif fresh_signal:
            conviction += 0.08
        if accumulation_source == "holder_built":
            conviction += 0.10
        elif accumulation_source in {"strategic_inflow", "mixed_inflow"}:
            conviction += 0.05
        return round(item["net_flow"] * conviction, 2)
    return derive_sell_pressure_score(item)


def build_flow_item(addr, holder_meta, inbound, outbound, chain_volume, outbound_buckets, inbound_buckets):
    """Build a normalized flow item for the dashboard."""
    balance = round(holder_meta.get("balance", 0))
    net_flow = round(inbound - outbound)
    if net_flow == 0:
        return None

    flow_chains = [chain for chain, volume in sorted(chain_volume.items(), key=lambda item: item[1], reverse=True) if volume > 0]
    retention_ratio = round(balance / inbound, 4) if inbound > 0 else None
    item = {
        "address": addr,
        "label": holder_meta.get("label", ""),
        "type": holder_meta.get("type", ""),
        "net_flow": net_flow,
        "balance": balance,
        "total_in": round(inbound),
        "total_out": round(outbound),
        "flow_chains": flow_chains,
        "flow_cohort": derive_flow_cohort(holder_meta),
    }
    item["flow_cohort_label"] = FLOW_COHORT_LABELS[item["flow_cohort"]]
    if retention_ratio is not None:
        item["retention_ratio"] = retention_ratio
    if flow_chains:
        item["primary_flow_chain"] = flow_chains[0]
    else:
        item["chain_unresolved"] = True
    fresh_flow_signal = derive_fresh_flow_signal(holder_meta, net_flow)
    if fresh_flow_signal:
        item["fresh_overlap"] = True
        item["fresh_flow_signal"] = fresh_flow_signal
        item["fresh_flow_label"] = FRESH_FLOW_LABELS[fresh_flow_signal]
    if inbound > 0:
        accumulation_source = derive_accumulation_source(inbound_buckets, holder_meta)
        item["accumulation_source"] = accumulation_source
        item["accumulation_source_label"] = ACCUMULATION_SOURCE_LABELS[accumulation_source]
    if outbound > 0:
        seller_profile = derive_seller_profile(outbound_buckets, holder_meta)
        item["seller_profile"] = seller_profile
        item["seller_profile_label"] = SELLER_PROFILE_LABELS[seller_profile]
        total_out = sum(outbound_buckets.values()) or outbound
        cex_outflow_ratio = (outbound_buckets.get("cex", 0) + outbound_buckets.get("coinbase", 0)) / total_out if total_out > 0 else 0
        external_outflow_ratio = outbound_buckets.get("unknown", 0) / total_out if total_out > 0 else 0
        item["cex_outflow_ratio"] = round(cex_outflow_ratio, 4)
        item["external_outflow_ratio"] = round(external_outflow_ratio, 4)
        item["sell_pressure_score"] = derive_sell_pressure_score(item)
    item["flow_score"] = derive_flow_score(item)
    return item


def get_net_retention_ratio(item):
    total_in = item.get("total_in", 0) or 0
    if total_in <= 0:
        return 0
    return item["net_flow"] / total_in


def get_balance_share(item):
    balance = item.get("balance", 0) or 0
    if balance <= 0:
        return 0
    return abs(item["net_flow"]) / balance


def get_net_retention_ratio(item):
    total_in = item.get("total_in", 0) or 0
    if total_in <= 0:
        return 0
    return item["net_flow"] / total_in


def is_meaningful_accumulator(item):
    """Positive net-flow holder who still retains a meaningful amount of ZRO."""
    if item["type"] in FLOW_INFRA_TYPES or item["net_flow"] <= 0 or item["balance"] <= 0:
        return False
    retention_ratio = item.get("retention_ratio", 0)
    net_retention_ratio = get_net_retention_ratio(item)
    balance_share = get_balance_share(item)
    min_balance = max(FLOW_MIN_BALANCE, abs(item["net_flow"]) * FLOW_MIN_RETENTION)
    keeps_meaningful_balance = retention_ratio >= FLOW_MIN_RETENTION or item["balance"] >= min_balance
    meaningful_period_signal = (
        item["net_flow"] >= FLOW_MIN_BALANCE
        or net_retention_ratio >= FLOW_MIN_NET_RETENTION
        or balance_share >= FLOW_MIN_BALANCE_SHARE
    )
    return keeps_meaningful_balance and meaningful_period_signal


def is_meaningful_seller(item):
    """Negative net-flow holder that still belongs to the tracked holder universe."""
    if item["type"] in FLOW_INFRA_TYPES or item["net_flow"] >= 0 or item["balance"] <= 0:
        return False
    abs_net_flow = abs(item["net_flow"])
    balance_share = get_balance_share(item)
    return abs_net_flow >= FLOW_MIN_BALANCE or balance_share >= FLOW_MIN_SELL_BALANCE_SHARE


def main():
    if not API_KEY:
        print("❌ ETHERSCAN_API_KEY not set")
        return

    with open(DATA_PATH) as f:
        data = json.load(f)

    holders = data.get("top_holders", [])
    now = int(time.time())

    # Load incremental cache
    cache = load_cache()
    is_incremental = bool(cache.get("last_blocks"))

    if is_incremental:
        print(f"⚡ INCREMENTAL MODE — fetching only new transfers since last run")
    else:
        print(f"🔄 FULL SCAN MODE — scanning {FULL_SCAN_DAYS} days of history")

    print(f"   Total holders in data: {len(holders)}")

    total_requests = 0
    new_transfers_total = 0

    # Process each chain
    for chain_name, chain_cfg in CHAINS.items():
        chain_id = chain_cfg["id"]
        block_time = chain_cfg["block_time"]
        top_n = chain_cfg["top_n"]

        # Get wallets with balance on this chain, sorted by chain balance
        chain_holders = [
            h for h in holders
            if h.get("balances", {}).get(chain_name, 0) > 0
        ]
        chain_holders.sort(key=lambda x: x.get("balances", {}).get(chain_name, 0), reverse=True)
        chain_holders = chain_holders[:top_n]

        if not chain_holders:
            print(f"\n   {chain_name}: 0 holders — skipped")
            continue

        current_block = get_current_block(chain_id)
        time.sleep(0.22)

        # Determine start block
        cache_key = chain_name
        if is_incremental and cache_key in cache["last_blocks"]:
            # Incremental: start from last scanned block + 1
            start_block = cache["last_blocks"][cache_key] + 1
            blocks_delta = current_block - start_block
            time_delta = blocks_delta * block_time
            print(f"\n⚡ {chain_name.upper()} (incremental: {blocks_delta:,} new blocks, ~{time_delta/3600:.1f}h)")
        else:
            # Full scan: go back FULL_SCAN_DAYS
            blocks_back = int(FULL_SCAN_DAYS * 86400 / block_time)
            start_block = max(0, current_block - blocks_back)
            print(f"\n🔗 {chain_name.upper()} (full scan: block {start_block}→{current_block})")

        print(f"   Scanning top {len(chain_holders)} holders")

        processed = 0
        chain_new = 0
        for h in chain_holders:
            addr = h["address"].lower()
            processed += 1

            # For wallets NOT yet in cache, do a full scan (not just delta)
            # This catches new holders whose historical transfers are missing
            if is_incremental and addr not in cache["transfers"]:
                blocks_back = int(FULL_SCAN_DAYS * 86400 / block_time)
                full_start = max(0, current_block - blocks_back)
                transfers = get_zro_transfers(addr, chain_name, chain_id, full_start)
                if transfers:
                    print(f"   🆕 Full scan for new wallet {addr[:10]}…: {len(transfers)} transfers")
            else:
                transfers = get_zro_transfers(addr, chain_name, chain_id, start_block)
            total_requests += 1
            time.sleep(0.22)

            if transfers:
                # Merge with existing cached transfers (dedup by tx_hash, fallback to tuple key)
                existing = cache["transfers"].get(addr, [])
                existing_hashes = set(
                    t["hash"] for t in existing if t.get("hash")
                )
                # Fallback dedup for old cache entries without hash
                existing_tuples = set(
                    (t["from"], t["to"], int(t["value"]*100), t["timestamp"], t.get("chain", ""))
                    for t in existing if not t.get("hash")
                )
                new_count = 0
                for t in transfers:
                    if t.get("hash") and t["hash"] in existing_hashes:
                        continue
                    if not t.get("hash"):
                        key = (t["from"], t["to"], int(t["value"]*100), t["timestamp"], t.get("chain", ""))
                        if key in existing_tuples:
                            continue
                    existing.append(t)
                    if t.get("hash"):
                        existing_hashes.add(t["hash"])
                    new_count += 1
                if existing:
                    cache["transfers"][addr] = existing
                chain_new += new_count

            if processed % 50 == 0:
                print(f"   ... {processed}/{len(chain_holders)}")

        # Update last scanned block for this chain
        cache["last_blocks"][cache_key] = current_block
        new_transfers_total += chain_new

        with_transfers = sum(1 for h in chain_holders if h["address"].lower() in cache["transfers"])
        print(f"   ✅ {processed} scanned, {chain_new} new transfers, {with_transfers} with history")

    # Prune transfers older than 365 days
    cutoff_ts = now - (FULL_SCAN_DAYS * 86400)
    pruned = prune_old_transfers(cache, cutoff_ts)
    if pruned:
        print(f"\n🗑️  Pruned {pruned} transfers older than {FULL_SCAN_DAYS}d")

    # Save cache for next incremental run
    save_cache(cache)
    cache_size = os.path.getsize(CACHE_PATH) / (1024 * 1024)
    print(f"💾 Cache saved ({cache_size:.1f} MB, {len(cache['transfers'])} wallets)")

    print(f"\n📈 Computing flows per period...")
    print(f"   Total wallets with transfers: {len(cache['transfers'])}")

    # Build label/type lookup
    holder_meta_map = {}
    for h in holders:
        addr = h["address"].lower()
        holder_meta_map[addr] = {
            "label": h.get("label", ""),
            "type": h.get("type", ""),
            "balance": round(sum(h.get("balances", {}).values())),
            "fresh": h.get("fresh"),
            "fresh_signal": h.get("fresh_signal", ""),
            "fresh_signal_label": h.get("fresh_signal_label", ""),
            "fresh_profile": h.get("fresh_profile", ""),
            "fresh_profile_label": h.get("fresh_profile_label", ""),
            "funded_by": h.get("funded_by", ""),
        }

    # Compute flows per period from cached transfers
    new_flows = {}

    for period_key, period_secs in PERIODS.items():
        cutoff = now - period_secs
        period_data = defaultdict(lambda: {
            "in": 0.0,
            "out": 0.0,
            "chain_volume": defaultdict(float),
            "outbound_buckets": defaultdict(float),
            "inbound_buckets": defaultdict(float),
        })

        for addr, transfers in cache["transfers"].items():
            for tx in transfers:
                if tx["timestamp"] < cutoff:
                    continue
                chain_name = tx.get("chain")
                if tx["to"] == addr:
                    period_data[addr]["in"] += tx["value"]
                    if chain_name:
                        period_data[addr]["chain_volume"][chain_name] += tx["value"]
                    bucket = classify_inbound_counterparty(tx.get("from"), holder_meta_map)
                    period_data[addr]["inbound_buckets"][bucket] += tx["value"]
                if tx["from"] == addr:
                    period_data[addr]["out"] += tx["value"]
                    if chain_name:
                        period_data[addr]["chain_volume"][chain_name] += tx["value"]
                    bucket = classify_outbound_counterparty(tx.get("to"), holder_meta_map)
                    period_data[addr]["outbound_buckets"][bucket] += tx["value"]

        # Build sorted lists
        acc = []
        sell = []
        for addr, stats in period_data.items():
            holder_meta = holder_meta_map.get(addr)
            if not holder_meta or holder_meta.get("balance", 0) <= 0:
                continue
            item = build_flow_item(addr, holder_meta, stats["in"], stats["out"], stats["chain_volume"], stats["outbound_buckets"], stats["inbound_buckets"])
            if not item:
                continue
            if is_meaningful_accumulator(item):
                acc.append(item)
            elif is_meaningful_seller(item):
                sell.append(item)

        acc = sorted(acc, key=lambda x: (x.get("flow_score", 0), x["net_flow"], x.get("retention_ratio", 0), x["balance"]), reverse=True)
        sell = sorted(sell, key=lambda x: (x.get("sell_pressure_score", x.get("flow_score", 0)), abs(x["net_flow"]), -x["balance"]), reverse=True)

        new_flows[period_key] = {"accumulators": acc, "sellers": sell}
        print(f"   {period_key}: {len(acc)} accumulators, {len(sell)} sellers")

    # Update data
    data["flows"] = new_flows
    data["meta"]["generated"] = time.strftime("%Y-%m-%dT%H:%M:%SZ")

    atomic_json_dump(data, DATA_PATH)

    mode = "INCREMENTAL" if is_incremental else "FULL"
    print(f"\n✅ Flow data saved! ({mode} mode)")
    print(f"   API calls: ~{total_requests}")
    print(f"   New transfers found: {new_transfers_total}")
    print(f"   Wallets with flow data: {len(cache['transfers'])}")


if __name__ == "__main__":
    main()
