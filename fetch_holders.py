#!/usr/bin/env python3
"""
Fetch all ZRO token holders across 7 chains.
Uses Etherscan V2 API (tokentx) as primary source.
Falls back to Alchemy (getAssetTransfers) for chains where Etherscan fails.
Filters for holders with > 10 ZRO.

Supports two modes:
  - INCREMENTAL (default): only fetch new transfers since last scan
  - FULL: scan all transfers from block 0 (weekly reset / first run)

State is stored in scan_state.json with lastBlock per chain.
"""
import json, time, sys, os, csv
from urllib.request import urlopen, Request
from collections import defaultdict
from datetime import datetime
from utils import atomic_json_dump, fetch_json, get_api_key

ETHERSCAN_KEY = get_api_key()
ALCHEMY_KEY = os.environ.get("ALCHEMY_API_KEY", "")
ZRO_CONTRACT = "0x6985884c4392d348587b19cb9eaaf157f13271cd"
MIN_BALANCE = 10
DECIMALS = 18
ZERO = "0x0000000000000000000000000000000000000000"

DIR = os.path.dirname(os.path.abspath(__file__))
STATE_FILE = os.path.join(DIR, "scan_state.json")
OUTPUT_FILE = os.path.join(DIR, "holders_multichain.json")

# Full rescan every Sunday (weekday 6)
FULL_RESCAN_DAY = 6  # 0=Mon, 6=Sun

CHAINS = {
    "ethereum":  {"chainid": 1,     "name": "Ethereum",  "short": "ETH"},
    "arbitrum":  {"chainid": 42161, "name": "Arbitrum",  "short": "ARB"},
    "base":      {"chainid": 8453,  "name": "Base",      "short": "BASE"},
    "bsc":       {"chainid": 56,    "name": "BNB Chain", "short": "BSC"},
    "optimism":  {"chainid": 10,    "name": "Optimism",  "short": "OP"},
    "polygon":   {"chainid": 137,   "name": "Polygon",   "short": "POLY"},
    "avalanche": {"chainid": 43114, "name": "Avalanche", "short": "AVAX"},
}

# Top N holders to keep per chain
TOP_PER_CHAIN = {
    "ethereum": 500,
    "arbitrum": 100,
    "base":     50,
    "bsc":      50,
    "optimism": 50,
    "polygon":  50,
    "avalanche": 50,
}

ALCHEMY_URLS = {
    "ethereum":  "eth-mainnet.g.alchemy.com",
    "arbitrum":  "arb-mainnet.g.alchemy.com",
    "base":      "base-mainnet.g.alchemy.com",
    "optimism":  "opt-mainnet.g.alchemy.com",
    "polygon":   "polygon-mainnet.g.alchemy.com",
}

# CSV files for chains not covered by APIs
CSV_DIR = os.path.join(DIR, "ZRO holders")
CSV_FILES = {
    "base":      "base.csv",
    "bsc":       "bsc.csv",
    "optimism":  "optimism.csv",
    "avalanche": "avalanche.csv",
    "polygon":   "polygon.csv",
    "arbitrum":  "arbitrum.csv",
    "ethereum":  "ethereum.csv",
}





def post_json(url, payload):
    data = json.dumps(payload).encode()
    for attempt in range(3):
        try:
            req = Request(url, data=data, headers={
                "User-Agent": "ZRO-Dashboard/1.0",
                "Content-Type": "application/json"
            })
            with urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode())
        except Exception as e:
            print(f"  ⚠️ POST attempt {attempt+1} failed: {e}")
            time.sleep(2)
    return None


# ─── State Management ───
def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f)
    return {}


def save_state(state):
    atomic_json_dump(state, STATE_FILE)


def should_full_rescan(state):
    """Check if we should do a full rescan (Sunday or first run)."""
    # Force full scan via env var
    if os.environ.get("FORCE_FULL_SCAN", "").lower() in ("1", "true", "yes"):
        return True

    # First run — no state
    if not state.get("last_full_scan"):
        return True

    # Sunday check
    today = datetime.utcnow().weekday()
    if today == FULL_RESCAN_DAY:
        last_full = state.get("last_full_scan", "")
        today_str = datetime.utcnow().strftime("%Y-%m-%d")
        if last_full != today_str:
            return True

    return False


# ─── Etherscan ───
def fetch_transfers_etherscan(chainid, start_block=0):
    all_txs = []
    page = 1
    offset = 10000
    max_block = 0

    while True:
        url = (
            f"https://api.etherscan.io/v2/api?chainid={chainid}"
            f"&module=account&action=tokentx"
            f"&contractaddress={ZRO_CONTRACT}"
            f"&startblock={start_block}&endblock=99999999"
            f"&page={page}&offset={offset}&sort=asc"
            f"&apikey={ETHERSCAN_KEY}"
        )

        data = fetch_json(url)
        if not data:
            break

        if data.get("status") != "1" or not data.get("result"):
            if page == 1:
                msg = data.get("result", data.get("message", "Unknown error"))
                print(f"  ⚠️ Etherscan returned: {msg}")
            break

        results = data["result"]
        all_txs.extend(results)

        # Track highest block
        for tx in results:
            bn = int(tx.get("blockNumber", "0"))
            if bn > max_block:
                max_block = bn

        print(f"  📦 Page {page}: {len(results)} transfers (total: {len(all_txs)})")

        if len(results) < offset:
            break

        page += 1
        time.sleep(0.25)

    return all_txs, max_block


# ─── Alchemy ───
def fetch_transfers_alchemy(chain_key, from_block="0x0"):
    if not ALCHEMY_KEY:
        return [], 0

    host = ALCHEMY_URLS.get(chain_key)
    if not host:
        return [], 0

    rpc_url = f"https://{host}/v2/{ALCHEMY_KEY}"
    all_txs = []
    page_key = None
    page = 0
    MAX_PAGES = 2000  # Cap at 2000 pages = 2M transfers max (safe within 60min timeout)
    max_block = 0

    while True:
        page += 1
        if page > MAX_PAGES:
            print(f"  ⚠️ Reached max pages ({MAX_PAGES}), stopping")
            break
        payload = {
            "id": 1,
            "jsonrpc": "2.0",
            "method": "alchemy_getAssetTransfers",
            "params": [{
                "fromBlock": from_block,
                "toBlock": "latest",
                "contractAddresses": [ZRO_CONTRACT],
                "category": ["erc20"],
                "withMetadata": False,
                "excludeZeroValue": True,
                "maxCount": "0x3E8",
            }]
        }

        if page_key:
            payload["params"][0]["pageKey"] = page_key

        data = post_json(rpc_url, payload)
        if not data or "result" not in data:
            if data and "error" in data:
                print(f"  ⚠️ Alchemy error: {data['error'].get('message', '')}")
            break

        result = data["result"]
        transfers = result.get("transfers", [])

        for tx in transfers:
            value_hex = tx.get("rawContract", {}).get("value", "0x0")
            try:
                value = str(int(value_hex, 16))
            except (ValueError, TypeError):
                value = "0"

            block_hex = tx.get("blockNum", "0x0")
            try:
                bn = int(block_hex, 16)
                if bn > max_block:
                    max_block = bn
            except (ValueError, TypeError):
                bn = 0

            all_txs.append({
                "from": tx.get("from", "").lower(),
                "to": tx.get("to", "").lower(),
                "value": value,
                "timeStamp": "0",
            })

        print(f"  📦 Page {page}: {len(transfers)} transfers (total: {len(all_txs)})")

        page_key = result.get("pageKey")
        if not page_key or len(transfers) == 0:
            break

        time.sleep(0.25)

    return all_txs, max_block


def compute_balances(transfers):
    balances = defaultdict(int)

    for tx in transfers:
        value = int(tx.get("value", "0"))
        from_addr = tx.get("from", "").lower()
        to_addr = tx.get("to", "").lower()

        if from_addr and from_addr != ZERO:
            balances[from_addr] -= value
        if to_addr and to_addr != ZERO:
            balances[to_addr] += value

    result = {}
    for addr, raw_balance in balances.items():
        balance = raw_balance / (10 ** DECIMALS)
        if balance > MIN_BALANCE:
            result[addr] = round(balance, 2)

    return result


def main():
    state = load_state()
    is_full = should_full_rescan(state)
    mode = "FULL" if is_full else "INCREMENTAL"

    print("🔍 ZRO Multi-Chain Holder Fetcher")
    print(f"   Mode: {mode}")
    print(f"   Contract: {ZRO_CONTRACT}")
    print(f"   Chains: {', '.join(c['short'] for c in CHAINS.values())}")
    print(f"   Etherscan: {'✅' if ETHERSCAN_KEY else '❌'}  Alchemy: {'✅' if ALCHEMY_KEY else '❌'}")
    print()

    # For incremental mode, load existing holders
    existing_holders = {}
    if not is_full and os.path.exists(OUTPUT_FILE):
        with open(OUTPUT_FILE) as f:
            existing = json.load(f)
        for h in existing.get("holders", []):
            existing_holders[h["address"].lower()] = h.get("balances", {})

    all_holders = {}
    chain_stats = {}

    for chain_key, chain_info in CHAINS.items():
        chainid = chain_info["chainid"]
        chain_state = state.get(chain_key, {})

        if is_full:
            start_block = 0
            print(f"🔗 [{chain_info['short']}] FULL scan from block 0...")
        else:
            start_block = chain_state.get("last_block", 0)
            if start_block > 0:
                start_block += 1  # Don't re-fetch the last block
            print(f"🔗 [{chain_info['short']}] Incremental from block {start_block:,}...")

        # Primary: Alchemy (full pagination, no 10K cap)
        transfers = []
        max_block = 0
        if ALCHEMY_KEY and chain_key in ALCHEMY_URLS:
            from_hex = hex(start_block) if start_block > 0 else "0x0"
            transfers, max_block = fetch_transfers_alchemy(chain_key, from_hex)

        # Fallback: Etherscan (only if Alchemy unavailable or returned nothing)
        if not transfers:
            transfers, max_block = fetch_transfers_etherscan(chainid, start_block)

        print(f"   Transfers fetched: {len(transfers)}")

        # Fallback to CSV if both APIs failed
        if not transfers:
            csv_file = CSV_FILES.get(chain_key)
            csv_path = os.path.join(CSV_DIR, csv_file) if csv_file else None
            if csv_path and os.path.exists(csv_path):
                print(f"  📁 APIs failed — loading from CSV: {csv_file}")
                csv_balances = {}
                with open(csv_path, "r", encoding="utf-8-sig") as f:
                    reader = csv.DictReader(f)
                    for row in reader:
                        addr = row.get("HolderAddress", "").strip().strip('"').lower()
                        bal_str = row.get("Balance", "").replace(",", "").replace('"', '').strip()
                        if not addr or not bal_str:
                            continue
                        try:
                            bal = float(bal_str)
                        except ValueError:
                            continue
                        if bal > MIN_BALANCE:
                            csv_balances[addr] = round(bal, 2)

                print(f"   Holders from CSV: {len(csv_balances)}")
                chain_stats[chain_key] = {"transfers": 0, "holders_gt10": len(csv_balances), "source": "CSV"}

                for addr, balance in csv_balances.items():
                    if addr not in all_holders:
                        all_holders[addr] = {"balances": {}}
                    all_holders[addr]["balances"][chain_key] = balance

                print(f"   ✅ Done! (CSV fallback)")
                print()
                time.sleep(0.5)
                continue

        if not transfers and not is_full:
            print(f"   No new transfers — keeping existing data")
            chain_stats[chain_key] = chain_state.get("stats", {"transfers": 0, "holders_gt10": 0})
            continue
        elif not transfers:
            chain_stats[chain_key] = {"transfers": 0, "holders_gt10": 0}
            continue

        if is_full:
            # Full mode: compute balances from all transfers
            balances = compute_balances(transfers)
        else:
            # Incremental: compute DELTAS and apply to existing balances
            deltas = defaultdict(int)
            for tx in transfers:
                value = int(tx.get("value", "0"))
                from_addr = tx.get("from", "").lower()
                to_addr = tx.get("to", "").lower()

                if from_addr and from_addr != ZERO:
                    deltas[from_addr] -= value
                if to_addr and to_addr != ZERO:
                    deltas[to_addr] += value

            # Apply deltas to existing balances
            balances = {}
            for addr in set(list(deltas.keys()) + [a for a, b in existing_holders.items() if chain_key in b]):
                existing_bal = existing_holders.get(addr, {}).get(chain_key, 0)
                delta = deltas.get(addr, 0) / (10 ** DECIMALS)
                new_bal = existing_bal + delta
                if new_bal > MIN_BALANCE:
                    balances[addr] = round(new_bal, 2)

        print(f"   Holders with >{MIN_BALANCE} ZRO: {len(balances)}")

        chain_stats[chain_key] = {
            "transfers": len(transfers),
            "holders_gt10": len(balances)
        }

        # Save last block
        if max_block > 0:
            if chain_key not in state:
                state[chain_key] = {}
            state[chain_key]["last_block"] = max_block
            state[chain_key]["stats"] = chain_stats[chain_key]

        # Merge into all_holders
        for addr, balance in balances.items():
            if addr not in all_holders:
                all_holders[addr] = {"balances": {}}
            all_holders[addr]["balances"][chain_key] = balance

        print(f"   ✅ Done! (max block: {max_block:,})")
        print()
        time.sleep(1)

    # For incremental mode, merge with existing holders (keep chains not re-scanned)
    if not is_full:
        for addr, chain_balances in existing_holders.items():
            if addr not in all_holders:
                # Keep existing holder entirely
                total = sum(chain_balances.values())
                if total > MIN_BALANCE:
                    all_holders[addr] = {"balances": chain_balances}
            else:
                # Merge chains not re-scanned
                for chain, bal in chain_balances.items():
                    if chain not in all_holders[addr]["balances"] and chain not in chain_stats:
                        all_holders[addr]["balances"][chain] = bal

    # Build output
    holders_list = []
    for addr, data in all_holders.items():
        total = sum(data["balances"].values())
        if total > MIN_BALANCE:
            holders_list.append({
                "address": addr,
                "label": "",
                "type": "WALLET",
                "balances": data["balances"],
                "total": round(total, 2)
            })

    holders_list.sort(key=lambda x: x["total"], reverse=True)
    pre_prune = len(holders_list)

    # --- Prune to top N per chain ---
    # Collect addresses that qualify as top per any chain
    keep_addrs = set()
    for chain_key, limit in TOP_PER_CHAIN.items():
        chain_sorted = sorted(
            [h for h in holders_list if chain_key in h["balances"]],
            key=lambda x: x["balances"].get(chain_key, 0),
            reverse=True
        )
        for h in chain_sorted[:limit]:
            keep_addrs.add(h["address"])

    # Also keep labeled wallets (from existing data) regardless of rank
    existing_data_path = os.path.join(DIR, "zro_data.json")
    if os.path.exists(existing_data_path):
        with open(existing_data_path) as f:
            existing_zro = json.load(f)
        for h in existing_zro.get("top_holders", []):
            if h.get("label"):
                keep_addrs.add(h["address"].lower())

    holders_list = [h for h in holders_list if h["address"] in keep_addrs]
    holders_list.sort(key=lambda x: x["total"], reverse=True)
    print(f"   ✂️ Pruned {pre_prune:,} → {len(holders_list)} holders (top per chain + labeled)")

    # Update state
    if is_full:
        state["last_full_scan"] = datetime.utcnow().strftime("%Y-%m-%d")
    state["last_scan"] = time.strftime("%Y-%m-%dT%H:%M:%SZ")
    state["mode"] = mode
    save_state(state)

    # Print summary
    print("=" * 60)
    print(f"📊 RESULTS ({mode})")
    print(f"   Total holders (>{MIN_BALANCE} ZRO): {len(holders_list)}")
    for ck, cs in chain_stats.items():
        print(f"   {CHAINS[ck]['short']}: {cs.get('transfers', 0)} transfers → {cs.get('holders_gt10', 0)} holders")
    print(f"   Top 5:")
    for h in holders_list[:5]:
        chains = ", ".join(f"{k}:{v:,.0f}" for k,v in h["balances"].items())
        print(f"     {h['address'][:10]}… = {h['total']:,.0f} ZRO ({chains})")
    print()

    # Save output
    atomic_json_dump({
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "min_balance": MIN_BALANCE,
        "total_holders": len(holders_list),
        "chain_stats": chain_stats,
        "scan_mode": mode,
        "holders": holders_list
    }, OUTPUT_FILE)

    print(f"💾 Saved to {OUTPUT_FILE}")
    print(f"   {len(holders_list)} holders | Mode: {mode}")


if __name__ == "__main__":
    main()
