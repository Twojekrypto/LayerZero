#!/usr/bin/env python3
"""
Hourly balance refresh for ZRO dashboard.

1. Refreshes live balances for top 500 holders via Etherscan tokenbalance API
2. Watches Token Unlocks wallet for new outgoing transfers (discover new wallets)
3. Preserves all existing labels and types

Designed to run every hour via GitHub Actions.
"""
import json, os, time
from urllib.request import urlopen, Request
from utils import atomic_json_dump, fetch_json

API_KEY = os.environ.get("ETHERSCAN_API_KEY", "")
ZRO_CONTRACT = "0x6985884c4392d348587b19cb9eaaf157f13271cd"
DECIMALS = 18
TOP_N = 500  # Refresh top N holders by balance
UNLOCK_WALLET = "0x637ca60dfb4d3acbd2ba65aaed9c6ca564bbf7bf"  # LayerZero: Token Unlocks
MIN_BALANCE_FOR_TRACK = 10_000  # Only add new wallets with > 10K ZRO

DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(DIR, "zro_data.json")

CHAINS = {
    "ethereum":  1,
    "arbitrum":  42161,
    "base":      8453,
    "bsc":       56,
    "optimism":  10,
    "polygon":   137,
    "avalanche": 43114,
}





def get_token_balance(address, chain_id=1):
    """Get live ZRO balance for an address on a specific chain."""
    url = (
        f"https://api.etherscan.io/v2/api?chainid={chain_id}"
        f"&module=account&action=tokenbalance"
        f"&contractaddress={ZRO_CONTRACT}"
        f"&address={address}&tag=latest"
        f"&apikey={API_KEY}"
    )
    data = fetch_json(url)
    if data and data.get("status") == "1":
        raw = int(data.get("result", "0"))
        return raw / (10 ** DECIMALS)
    return None


def get_recent_unlock_transfers(since_hours=2):
    """Get recent ZRO transfers FROM the Token Unlocks wallet.
    Returns list of {to_address, value} for transfers in the last N hours."""
    cutoff = int(time.time()) - (since_hours * 3600)
    url = (
        f"https://api.etherscan.io/v2/api?chainid=1"
        f"&module=account&action=tokentx"
        f"&address={UNLOCK_WALLET}"
        f"&contractaddress={ZRO_CONTRACT}"
        f"&page=1&offset=100&sort=desc"
        f"&apikey={API_KEY}"
    )
    data = fetch_json(url)
    if not data or data.get("status") != "1" or not data.get("result"):
        return []

    new_recipients = []
    for tx in data["result"]:
        ts = int(tx.get("timeStamp", 0))
        if ts < cutoff:
            break
        from_addr = tx.get("from", "").lower()
        to_addr = tx.get("to", "").lower()
        value = int(tx.get("value", "0")) / (10 ** DECIMALS)
        # Only outgoing transfers from Unlock wallet
        if from_addr == UNLOCK_WALLET.lower() and value >= MIN_BALANCE_FOR_TRACK:
            new_recipients.append({"address": to_addr, "value": value})

    return new_recipients


def main():
    if not API_KEY:
        print("❌ ETHERSCAN_API_KEY not set")
        return

    with open(DATA_PATH) as f:
        data = json.load(f)

    holders = data.get("top_holders", [])
    print(f"🔄 ZRO Balance Refresh")
    print(f"   Total holders in data: {len(holders)}")

    # ── Step 1: Watch Token Unlocks for new recipients ──
    print(f"\n📡 Watching Token Unlocks for new transfers...")
    known_addrs = {h["address"].lower() for h in holders}
    new_transfers = get_recent_unlock_transfers(since_hours=2)
    new_count = 0

    for tx in new_transfers:
        if tx["address"] not in known_addrs:
            holders.append({
                "address": tx["address"],
                "balances": {"ethereum": round(tx["value"])},
                "label": "",
                "type": ""
            })
            known_addrs.add(tx["address"])
            new_count += 1
            print(f"   🆕 NEW: {tx['address'][:14]}... {tx['value']:,.0f} ZRO from Token Unlocks")

    if new_count == 0:
        print(f"   No new recipients found")
    else:
        print(f"   ➕ Added {new_count} new wallets")

    time.sleep(0.25)  # Rate limit pause

    # ── Step 2: Select top N by balance for refresh ──
    holders.sort(key=lambda x: sum(x.get("balances", {}).values()), reverse=True)
    top_holders = holders[:TOP_N]
    print(f"\n🔄 Refreshing live balances for top {len(top_holders)} holders...")

    # Collect unique chains each holder has balances on
    updated = 0
    errors = 0
    req_count = 0

    for i, h in enumerate(top_holders):
        addr = h["address"]
        old_balances = h.get("balances", {})

        # Determine which chains to check
        chains_to_check = list(old_balances.keys()) if old_balances else ["ethereum"]
        # Always include ethereum
        if "ethereum" not in chains_to_check:
            chains_to_check.append("ethereum")

        new_balances = {}
        for chain in chains_to_check:
            chain_id = CHAINS.get(chain)
            if not chain_id:
                new_balances[chain] = old_balances.get(chain, 0)
                continue

            bal = get_token_balance(addr, chain_id)
            req_count += 1

            if bal is not None:
                new_balances[chain] = round(bal)
            else:
                # Keep old value on API error
                new_balances[chain] = old_balances.get(chain, 0)
                errors += 1

            # Rate limit: 5 req/s → 0.22s between requests
            time.sleep(0.22)

        # Check if balance changed
        old_total = sum(old_balances.values())
        new_total = sum(new_balances.values())
        if old_total != new_total:
            updated += 1
            diff = new_total - old_total
            label = h.get("label", "")
            sign = "+" if diff > 0 else ""
            if abs(diff) > 1000:
                print(f"   {'📈' if diff > 0 else '📉'} {addr[:14]}... {label:20s} {old_total:>12,.0f} → {new_total:>12,.0f} ({sign}{diff:,.0f})")

        h["balances"] = new_balances

        # Progress every 100
        if (i + 1) % 100 == 0:
            print(f"   ... {i+1}/{len(top_holders)} refreshed ({req_count} API calls)")

    # ── Step 3: Re-sort and save ──
    holders.sort(key=lambda x: sum(x.get("balances", {}).values()), reverse=True)
    data["top_holders"] = holders
    data["meta"]["generated"] = time.strftime("%Y-%m-%dT%H:%M:%SZ")

    # Sync labels in flows data
    label_map = {h["address"].lower(): {"label": h.get("label", ""), "type": h.get("type", "")}
                 for h in holders if h.get("label")}
    for period_data in data.get("flows", {}).values():
        for flow_type in ["accumulators", "sellers"]:
            for item in period_data.get(flow_type, []):
                addr = item["address"].lower()
                if addr in label_map:
                    item["label"] = label_map[addr]["label"]
                    item["type"] = label_map[addr]["type"]

    atomic_json_dump(data, DATA_PATH)

    print(f"\n✅ Done!")
    print(f"   API calls: {req_count}")
    print(f"   Balances updated: {updated}")
    print(f"   API errors: {errors}")
    print(f"   New wallets discovered: {new_count}")
    print(f"   Generated: {data['meta']['generated']}")


if __name__ == "__main__":
    main()
