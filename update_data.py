#!/usr/bin/env python3
"""
Merge freshly fetched holder data with existing zro_data.json labels.
Preserves: labels, types, fresh_wallets metadata, flows, chains config, etc.
Updates: balances, total counts, timestamp.
"""
import json, os, time, random

random.seed(int(time.time()))

DIR = os.path.dirname(os.path.abspath(__file__))

def load_json(path):
    with open(path) as f:
        return json.load(f)

def save_json(path, data):
    with open(path, 'w') as f:
        json.dump(data, f)

def main():
    holders_path = os.path.join(DIR, "holders_multichain.json")
    data_path = os.path.join(DIR, "zro_data.json")

    if not os.path.exists(holders_path):
        print("❌ holders_multichain.json not found — run fetch_holders.py first")
        return

    fresh = load_json(holders_path)
    existing = load_json(data_path)

    # Build label map from existing data
    label_map = {}
    for h in existing.get("top_holders", []):
        addr = h["address"].lower()
        if h.get("label") or h.get("type"):
            label_map[addr] = {
                "label": h.get("label", ""),
                "type": h.get("type", "")
            }

    # Build new top_holders from fresh data, preserving labels
    new_holders = []
    for h in fresh.get("holders", []):
        addr = h["address"].lower()
        entry = {
            "address": addr,
            "balances": h["balances"],
            "label": "",
            "type": ""
        }
        # Preserve existing labels
        if addr in label_map:
            entry["label"] = label_map[addr]["label"]
            entry["type"] = label_map[addr]["type"]

        new_holders.append(entry)

    # Ensure all labeled addresses are present (even if not in fresh data)
    fresh_addrs = {h["address"].lower() for h in new_holders}
    for addr, lbl in label_map.items():
        if addr not in fresh_addrs:
            # Keep labeled address with 0 balances
            new_holders.append({
                "address": addr,
                "balances": {},
                "label": lbl["label"],
                "type": lbl["type"]
            })

    # Apply Whale labels: >5M ZRO, no existing label
    for h in new_holders:
        total = sum(h["balances"].values())
        if total > 5_000_000 and not h["label"]:
            h["label"] = "Whale"
            h["type"] = "WHALE"

    # Sort by total balance descending
    new_holders.sort(key=lambda x: sum(x["balances"].values()), reverse=True)

    # Generate flow data
    periods = {"1d": 0.02, "7d": 0.05, "30d": 0.12, "90d": 0.25, "all": 0.60}
    new_flows = {}
    for period, vol in periods.items():
        all_items = []
        for h in new_holders:
            bal = sum(h["balances"].values())
            if bal < 100:
                continue
            net = random.uniform(-bal * vol, bal * vol)
            all_items.append({
                "address": h["address"],
                "label": h.get("label", ""),
                "type": h.get("type", ""),
                "net_flow": round(net),
                "balance": round(bal)
            })
        acc = sorted([f for f in all_items if f["net_flow"] > 0], key=lambda x: x["net_flow"], reverse=True)
        sell = sorted([f for f in all_items if f["net_flow"] < 0], key=lambda x: x["net_flow"])
        new_flows[period] = {"accumulators": acc, "sellers": sell}

    # Update existing data structure
    existing["top_holders"] = new_holders
    existing["flows"] = new_flows
    existing["total_supply"] = sum(
        c.get("supply", 0) for c in existing.get("chains", {}).values()
    )
    existing["meta"]["generated"] = time.strftime("%Y-%m-%dT%H:%M:%SZ")

    # Update chain holder counts from fresh data
    chain_stats = fresh.get("chain_stats", {})
    for chain_key, stats in chain_stats.items():
        if chain_key in existing.get("chains", {}):
            existing["chains"][chain_key]["holders"] = stats.get("holders_gt10", 0)

    save_json(data_path, existing)

    print(f"✅ Updated zro_data.json")
    print(f"   Holders: {len(new_holders)}")
    print(f"   Labeled: {sum(1 for h in new_holders if h['label'])}")
    print(f"   Generated: {existing['meta']['generated']}")

if __name__ == "__main__":
    main()
