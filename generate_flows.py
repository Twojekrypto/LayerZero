#!/usr/bin/env python3
"""
Generate real ZRO flow data from on-chain transfers.

For each tracked wallet, fetch actual ZRO token transfers from Etherscan
and compute real net_flow (IN - OUT) per period (1D, 7D, 30D, 90D, ALL).

Replaces the fake random flow data from update_data.py.
"""
import json, os, time
from urllib.request import urlopen, Request
from collections import defaultdict

API_KEY = os.environ.get("ETHERSCAN_API_KEY", "")
ZRO_CONTRACT = "0x6985884c4392d348587b19cb9eaaf157f13271cd"
DECIMALS = 18
TOP_N = 200  # Compute flows for top N holders (by balance)

DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(DIR, "zro_data.json")

# Period definitions in seconds
PERIODS = {
    "1d":  1 * 86400,
    "7d":  7 * 86400,
    "30d": 30 * 86400,
    "90d": 90 * 86400,
    "all": 365 * 5 * 86400,  # ~5 years = effectively "all"
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


def get_zro_transfers(address, start_block=0):
    """Fetch all ZRO token transfers for an address since start_block.
    Returns list of {from, to, value, timestamp}."""
    transfers = []
    page = 1

    while True:
        url = (
            f"https://api.etherscan.io/v2/api?chainid=1"
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

        # If we got less than 1000, we've reached the end
        if len(results) < 1000:
            break

        page += 1
        time.sleep(0.22)

    return transfers


def estimate_block_for_timestamp(target_ts):
    """Estimate Ethereum block number for a target timestamp."""
    now_ts = int(time.time())
    current_block_url = (
        f"https://api.etherscan.io/v2/api?chainid=1"
        f"&module=proxy&action=eth_blockNumber"
        f"&apikey={API_KEY}"
    )
    data = fetch_json(current_block_url)
    if data and data.get("result"):
        current_block = int(data["result"], 16)
        seconds_ago = now_ts - target_ts
        blocks_ago = seconds_ago // 12  # ~12s per block
        return max(0, current_block - blocks_ago)
    return 0


def main():
    if not API_KEY:
        print("❌ ETHERSCAN_API_KEY not set")
        return

    with open(DATA_PATH) as f:
        data = json.load(f)

    holders = data.get("top_holders", [])
    now = int(time.time())

    # Sort by balance, take top N
    holders_sorted = sorted(holders, key=lambda x: sum(x.get("balances", {}).values()), reverse=True)
    top_holders = holders_sorted[:TOP_N]

    print(f"📊 Real ZRO Flow Generator")
    print(f"   Top {len(top_holders)} holders to process")

    # Estimate start block for 90d (covers all periods)
    start_ts = now - PERIODS["90d"]
    start_block = estimate_block_for_timestamp(start_ts)
    print(f"   Start block (90d ago): ~{start_block}")
    time.sleep(0.25)

    # Per-address flow data: address -> [{from, to, value, timestamp}]
    address_flows = {}
    processed = 0
    errors = 0

    for h in top_holders:
        addr = h["address"].lower()
        processed += 1

        transfers = get_zro_transfers(addr, start_block)
        time.sleep(0.22)

        if transfers:
            address_flows[addr] = transfers

        if processed % 25 == 0:
            print(f"   ... {processed}/{len(top_holders)} processed ({len(address_flows)} with transfers)")

    print(f"\n   ✅ Fetched transfers for {len(address_flows)} wallets")

    # Build label/type lookup
    label_map = {}
    balance_map = {}
    for h in holders:
        addr = h["address"].lower()
        label_map[addr] = {"label": h.get("label", ""), "type": h.get("type", "")}
        balance_map[addr] = round(sum(h.get("balances", {}).values()))

    # Compute flows per period
    print(f"\n📈 Computing flows per period...")
    new_flows = {}

    for period_key, period_secs in PERIODS.items():
        cutoff = now - period_secs
        period_data = defaultdict(float)  # addr -> net_flow

        # Go through all fetched transfers
        for addr, transfers in address_flows.items():
            net = 0.0
            for tx in transfers:
                if tx["timestamp"] < cutoff:
                    continue
                if tx["to"] == addr:
                    net += tx["value"]  # Inflow
                if tx["from"] == addr:
                    net -= tx["value"]  # Outflow
            if abs(net) > 0.01:
                period_data[addr] = round(net)

        # Also include top holders with 0 flow (no transfers in period)
        for h in top_holders:
            addr = h["address"].lower()
            if addr not in period_data:
                period_data[addr] = 0

        # Build sorted lists
        all_items = []
        for addr, net_flow in period_data.items():
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

    print(f"\n✅ Real flow data saved to {DATA_PATH}")
    print(f"   Processed: {processed} wallets")
    print(f"   API calls: ~{processed + 1}")


if __name__ == "__main__":
    main()
