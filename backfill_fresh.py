#!/usr/bin/env python3
"""
One-time backfill: populate wallet_created + last_flow for existing
Fresh Wallets and clean zero-balance holders.
Run locally or in CI, then delete this script.
"""
import json, os, time
from cex_addresses import KNOWN_CEX_ADDRESSES
from fresh_wallet_utils import (
    analyze_cex_interactions,
    apply_fresh_profile,
    get_first_activity_timestamp_multichain,
    get_latest_zro_transfer_context_multichain,
)
from utils import atomic_json_dump, get_api_key

API_KEY = get_api_key()
ZRO_CONTRACT = "0x6985884c4392d348587b19cb9eaaf157f13271cd"
DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(DIR, "zro_data.json")
CACHE_PATH = os.path.join(DIR, "fresh_cache.json")

def get_first_tx(address):
    """Get wallet creation timestamp from first activity across supported chains."""
    return get_first_activity_timestamp_multichain(address, API_KEY)


def get_last_zro_transfer(address, label_map):
    """Get latest multi-chain ZRO transfer context for a wallet."""
    funder, ts, amount, _chain_id, _chain_name = get_latest_zro_transfer_context_multichain(
        address,
        ZRO_CONTRACT,
        API_KEY,
        label_map=label_map,
        max_per_chain=20,
    )
    return funder, ts, amount


def main():
    if not API_KEY:
        print("❌ Set ETHERSCAN_API_KEY")
        return

    with open(DATA_PATH) as f:
        data = json.load(f)

    # Load fresh cache to update first_ts
    cache = {}
    if os.path.exists(CACHE_PATH):
        with open(CACHE_PATH) as f:
            cache = json.load(f)

    label_map = {}
    for h in data["top_holders"]:
        label = h.get("label")
        if label:
            label_map[h["address"].lower()] = label
    for addr, name in KNOWN_CEX_ADDRESSES.items():
        label_map[addr.lower()] = name

    # --- 1. Backfill wallet_created + last_flow for Fresh wallets ---
    fresh = [h for h in data["top_holders"] if h.get("type") == "FRESH"]
    print(f"🔧 Backfilling {len(fresh)} fresh wallets...")

    backfilled = 0
    for h in fresh:
        addr = h["address"].lower()
        needs_created = not h.get("wallet_created")
        needs_flow = not h.get("last_flow")
        needs_profile = not h.get("fresh_profile")
        needs_signal = not h.get("fresh_signal")

        if not needs_created and not needs_flow and not needs_profile and not needs_signal:
            continue

        if needs_created:
            ts = get_first_tx(addr)
            if ts:
                h["wallet_created"] = ts
                # Also update fresh_cache
                if addr in cache:
                    cache[addr]["first_ts"] = ts
                print(f"  ✅ {addr[:14]}... wallet_created = {ts}")
            time.sleep(0.25)

        if needs_flow or not h.get("funded_by"):
            funder, li_ts, li_amt = get_last_zro_transfer(addr, label_map)
            if li_ts:
                h["last_flow"] = li_ts
                h["last_flow_amount"] = li_amt
                print(f"  ✅ {addr[:14]}... last_flow = {li_ts}, amount = {li_amt:+,.0f}")
            if funder and not h.get("funded_by"):
                h["funded_by"] = funder
            time.sleep(0.25)

        if needs_profile or needs_signal:
            profile = analyze_cex_interactions(addr, KNOWN_CEX_ADDRESSES, ZRO_CONTRACT, API_KEY, max_per_chain=80)
            apply_fresh_profile(h, profile)
            print(f"  ✅ {addr[:14]}... fresh_profile = {h['fresh_profile']} / signal = {h['fresh_signal']}")
            time.sleep(0.25)

        backfilled += 1

    # --- 2. Clean zero-balance holders ---
    before = len(data["top_holders"])
    data["top_holders"] = [h for h in data["top_holders"] if sum(h.get("balances", {}).values()) > 0]
    removed = before - len(data["top_holders"])
    print(f"🧹 Removed {removed} zero-balance holders ({before} → {len(data['top_holders'])})")

    # --- 3. Remove duplicates ---
    seen = set()
    deduped = []
    for h in data["top_holders"]:
        addr = h["address"].lower()
        if addr not in seen:
            seen.add(addr)
            deduped.append(h)
    dup_count = len(data["top_holders"]) - len(deduped)
    if dup_count:
        print(f"🔄 Removed {dup_count} duplicate holders")
    data["top_holders"] = deduped

    # Save
    atomic_json_dump(data, DATA_PATH)
    if cache:
        atomic_json_dump(cache, CACHE_PATH)

    print(f"\n✅ Done! Backfilled {backfilled} wallets, cleaned {removed} zeros, {dup_count} dupes")


if __name__ == "__main__":
    main()
