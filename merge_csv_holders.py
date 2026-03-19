#!/usr/bin/env python3
"""
Merge CSV holder exports from 7 chains into zro_data.json.
Filters holders with total >10 ZRO.
Merges same-address across chains.
"""
import csv, json, os
from collections import defaultdict

CSV_DIR = os.path.join(os.path.dirname(__file__), "ZRO holders")
MIN_BALANCE = 10

# Map CSV filename → chain key in zro_data.json
CSV_CHAIN_MAP = {
    "ethereum.csv": "ethereum",
    "Arbitrum ZRO.csv": "arbitrum",
    "BASE.csv": "base",
    "bsc.csv": "bsc",
    "OPtymism.csv": "optimism",
    "polygon.csv": "polygon",
    "AVAX.csv": "avalanche",
}

# Known labels
KNOWN_LABELS = {
    "0x921949cc006a563d76abd111a3e4c2ace2c4273f": ("LayerZero: STG to ZRO Redemption", "PROTOCOL"),
    "0x7be1125e9284ee108850a19f362b111526737cfd": ("Coinbase Prime Whale", "INST"),
}

def parse_balance(balance_str):
    """Parse balance string like '105,935,088.37202644' to float."""
    if not balance_str:
        return 0.0
    return float(str(balance_str).replace(",", "").replace('"', '').strip())

def main():
    # {address: {chain: balance, ...}}
    all_holders = defaultdict(lambda: defaultdict(float))
    chain_counts = {}

    for csv_file, chain_key in CSV_CHAIN_MAP.items():
        filepath = os.path.join(CSV_DIR, csv_file)
        if not os.path.exists(filepath):
            print(f"⚠️ Missing: {csv_file}")
            continue

        count = 0
        with open(filepath, "r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                addr_raw = row.get("HolderAddress", "")
                bal_raw = row.get("Balance", "")
                if not addr_raw or not bal_raw:
                    continue
                addr = addr_raw.strip().strip('"').lower()
                try:
                    balance = parse_balance(bal_raw)
                except (ValueError, KeyError):
                    continue
                if balance > 0:
                    all_holders[addr][chain_key] = round(balance, 2)
                    count += 1

        chain_counts[chain_key] = count
        print(f"✅ {chain_key:12s} ({csv_file}): {count:>8,} addresses loaded")

    # Compute totals and filter
    holders_list = []
    for addr, chain_balances in all_holders.items():
        total = sum(chain_balances.values())
        if total >= MIN_BALANCE:
            label, htype = KNOWN_LABELS.get(addr, ("", "WALLET"))
            holders_list.append({
                "address": addr,
                "label": label,
                "type": htype,
                "balances": dict(chain_balances),
                "total": round(total, 2)
            })

    holders_list.sort(key=lambda x: x["total"], reverse=True)

    # Stats
    total_all = sum(c for c in chain_counts.values())
    multi_chain = sum(1 for h in holders_list if len(h["balances"]) > 1)
    
    print(f"\n{'='*60}")
    print(f"📊 MERGE RESULTS")
    print(f"   Total addresses loaded:        {total_all:>10,}")
    print(f"   After >={MIN_BALANCE} ZRO filter:      {len(holders_list):>10,}")
    print(f"   Multi-chain holders:            {multi_chain:>10,}")
    print(f"\n   Per-chain breakdown (after filter):")
    for ck in CSV_CHAIN_MAP.values():
        cnt = sum(1 for h in holders_list if ck in h["balances"])
        print(f"     {ck:12s}: {cnt:>8,} holders")
    
    print(f"\n   Top 10 holders:")
    for i, h in enumerate(holders_list[:10], 1):
        chains = ", ".join(f"{k}:{v:,.0f}" for k, v in sorted(h["balances"].items(), key=lambda x: -x[1]))
        label = f" [{h['label']}]" if h['label'] else ""
        print(f"     {i:>2}. {h['address'][:12]}…{label} = {h['total']:>15,.0f} ZRO ({chains})")

    # Update zro_data.json
    data_file = os.path.join(os.path.dirname(__file__), "zro_data.json")
    with open(data_file) as f:
        data = json.load(f)

    data["top_holders"] = holders_list

    with open(data_file, "w") as f:
        json.dump(data, f, indent=2)

    size_mb = os.path.getsize(data_file) / (1024 * 1024)
    print(f"\n💾 Updated zro_data.json ({size_mb:.1f} MB)")
    print(f"   {len(holders_list)} holders ready for dashboard!")

if __name__ == "__main__":
    main()
