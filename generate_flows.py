#!/usr/bin/env python3
"""
Generate real ZRO flow data from on-chain transfers (multi-chain).

For each tracked wallet, fetch actual ZRO token transfers from Etherscan V2 API
across all chains and compute real net_flow (IN - OUT) per period (1D, 7D, 30D, 90D, ALL).

Per-chain wallet limits (sorted by balance on that chain):
  Ethereum:  600
  Arbitrum:  100
  Others:    50 each
"""
import json, os, time
from urllib.request import urlopen, Request
from collections import defaultdict

API_KEY = os.environ.get("ETHERSCAN_API_KEY", "")
ZRO_CONTRACT = "0x6985884c4392d348587b19cb9eaaf157f13271cd"
DECIMALS = 18

DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(DIR, "zro_data.json")

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


def fetch_json(url):
    for attempt in range(3):
        try:
            req = Request(url, headers={"User-Agent": "ZRO-Dashboard/1.0"})
            with urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode())
        except Exception as e:
            if attempt < 2:
                time.sleep(2)
    return None


def get_zro_transfers(address, chain_id, start_block=0):
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
                "from": tx.get("from", "").lower(),
                "to": tx.get("to", "").lower(),
                "value": int(tx.get("value", "0")) / (10 ** DECIMALS),
                "timestamp": int(tx.get("timeStamp", "0")),
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
        return int(data["result"], 16)
    return 0


def main():
    if not API_KEY:
        print("❌ ETHERSCAN_API_KEY not set")
        return

    with open(DATA_PATH) as f:
        data = json.load(f)

    holders = data.get("top_holders", [])
    now = int(time.time())

    print(f"📊 Real ZRO Flow Generator (Multi-Chain)")
    print(f"   Total holders in data: {len(holders)}")

    # Per-address flow data: address -> [{from, to, value, timestamp}]
    address_flows = defaultdict(list)
    total_requests = 0

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

        # Estimate start block for 365d (scan full year of transfers)
        current_block = get_current_block(chain_id)
        time.sleep(0.22)
        blocks_365d = int(365 * 86400 / block_time)
        start_block = max(0, current_block - blocks_365d)

        print(f"\n🔗 {chain_name.upper()} (chainid={chain_id})")
        print(f"   Scanning top {len(chain_holders)} holders (block {start_block}→{current_block})")

        processed = 0
        for h in chain_holders:
            addr = h["address"].lower()
            processed += 1

            transfers = get_zro_transfers(addr, chain_id, start_block)
            total_requests += 1
            time.sleep(0.22)

            if transfers:
                address_flows[addr].extend(transfers)

            if processed % 50 == 0:
                print(f"   ... {processed}/{len(chain_holders)}")

        with_transfers = sum(1 for h in chain_holders if h["address"].lower() in address_flows)
        print(f"   ✅ {processed} scanned, {with_transfers} with transfers")

    print(f"\n📈 Computing flows per period...")
    print(f"   Total wallets with transfers: {len(address_flows)}")

    # Build label/type lookup
    label_map = {}
    balance_map = {}
    for h in holders:
        addr = h["address"].lower()
        label_map[addr] = {"label": h.get("label", ""), "type": h.get("type", "")}
        balance_map[addr] = round(sum(h.get("balances", {}).values()))

    # Compute flows per period
    new_flows = {}

    for period_key, period_secs in PERIODS.items():
        cutoff = now - period_secs
        period_data = defaultdict(float)

        for addr, transfers in address_flows.items():
            net = 0.0
            for tx in transfers:
                if tx["timestamp"] < cutoff:
                    continue
                if tx["to"] == addr:
                    net += tx["value"]
                if tx["from"] == addr:
                    net -= tx["value"]
            if abs(net) > 0.01:
                period_data[addr] = round(net)

        # Build sorted lists (only include wallets with non-zero flow)
        all_items = []
        for addr, net_flow in period_data.items():
            if net_flow == 0:
                continue
            all_items.append({
                "address": addr,
                "label": label_map.get(addr, {}).get("label", ""),
                "type": label_map.get(addr, {}).get("type", ""),
                "net_flow": round(net_flow),
                "balance": balance_map.get(addr, 0)
            })

        acc = sorted([f for f in all_items if f["net_flow"] > 0], key=lambda x: x["net_flow"], reverse=True)
        sell = sorted([f for f in all_items if f["net_flow"] < 0], key=lambda x: x["net_flow"])

        new_flows[period_key] = {"accumulators": acc, "sellers": sell}
        print(f"   {period_key}: {len(acc)} accumulators, {len(sell)} sellers")

    # Update data
    data["flows"] = new_flows
    data["meta"]["generated"] = time.strftime("%Y-%m-%dT%H:%M:%SZ")

    with open(DATA_PATH, "w") as f:
        json.dump(data, f, indent=2)

    print(f"\n✅ Real flow data saved!")
    print(f"   Total API calls: ~{total_requests}")
    print(f"   Wallets with transfers: {len(address_flows)}")


if __name__ == "__main__":
    main()
