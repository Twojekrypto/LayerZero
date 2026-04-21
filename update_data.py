#!/usr/bin/env python3
"""
Merge freshly fetched holder data with existing zro_data.json labels.
Preserves: labels, types, fresh_wallets metadata, flows, chains config, etc.
Updates: balances, total counts, timestamp.
"""
import json, os, time
from cex_addresses import KNOWN_CEX_ADDRESSES
from utils import atomic_json_dump

DIR = os.path.dirname(os.path.abspath(__file__))

def load_json(path):
    with open(path) as f:
        return json.load(f)

def save_json(path, data):
    atomic_json_dump(data, path)


def compute_holder_chain_balances(holders):
    totals = {}
    for holder in holders:
        for chain, value in (holder.get("balances") or {}).items():
            totals[chain] = totals.get(chain, 0) + float(value or 0)
    return {chain: round(total, 2) for chain, total in totals.items() if total > 0}


def sync_chain_snapshot_supply(existing, chain_stats, holders, synced_at):
    holder_totals = compute_holder_chain_balances(holders)
    chains = existing.get("chains", {})
    for chain_key, chain_config in chains.items():
        tracked_supply = float((chain_stats.get(chain_key) or {}).get("tracked_balance_gt10") or holder_totals.get(chain_key) or 0)
        if chain_config.get("reference_supply") in (None, "") and chain_config.get("supply") not in (None, ""):
            chain_config["reference_supply"] = chain_config.get("supply")
        if chain_config.get("reference_verified_date") in (None, "") and chain_config.get("verified_date"):
            chain_config["reference_verified_date"] = chain_config.get("verified_date")
        if tracked_supply > 0:
            chain_config["supply"] = round(tracked_supply, 2)
            chain_config["supply_source"] = "indexed_holder_snapshot"
            chain_config["supply_synced_at"] = synced_at


def is_locked_fresh(holder):
    return holder.get("type") == "FRESH" or holder.get("label") == "Fresh Wallet" or holder.get("fresh") is True


def apply_preserved_metadata(entry, preserved):
    for key in (
        "label",
        "type",
        "funded_by",
        "fresh",
        "label_manual",
        "fresh_profile",
        "fresh_profile_label",
        "fresh_profile_reason",
        "fresh_signal",
        "fresh_signal_label",
        "fresh_signal_score",
        "fresh_retention_ratio",
        "fresh_net_accumulation",
        "fresh_total_in_value",
        "fresh_total_out_value",
        "fresh_total_in_count",
        "fresh_total_out_count",
        "fresh_outbound_counterparties",
        "fresh_outbound_ratio",
        "fresh_cex_outbound_ratio",
        "fresh_cex_score",
        "fresh_cex_in_count",
        "fresh_cex_out_count",
        "fresh_cex_touch_count",
        "fresh_cex_in_value",
        "fresh_cex_out_value",
        "wallet_created",
        "last_flow",
        "last_flow_amount",
        "cb_first_funded",
        "cb_last_funded",
        "cb_total_received",
        "cb_last_flow_amount",
    ):
        if preserved.get(key) is not None:
            entry[key] = preserved[key]

    if is_locked_fresh(entry):
        entry["label"] = "Fresh Wallet"
        entry["type"] = "FRESH"
        entry["fresh"] = True
        entry["label_manual"] = True

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
        if h.get("label") or h.get("type") or h.get("label_manual") or h.get("fresh"):
            label_map[addr] = {
                "label": h.get("label", ""),
                "type": h.get("type", ""),
                "funded_by": h.get("funded_by"),
                "fresh": h.get("fresh"),
                "label_manual": h.get("label_manual"),
                "fresh_profile": h.get("fresh_profile"),
                "fresh_profile_label": h.get("fresh_profile_label"),
                "fresh_profile_reason": h.get("fresh_profile_reason"),
                "fresh_signal": h.get("fresh_signal"),
                "fresh_signal_label": h.get("fresh_signal_label"),
                "fresh_signal_score": h.get("fresh_signal_score"),
                "fresh_retention_ratio": h.get("fresh_retention_ratio"),
                "fresh_net_accumulation": h.get("fresh_net_accumulation"),
                "fresh_total_in_value": h.get("fresh_total_in_value"),
                "fresh_total_out_value": h.get("fresh_total_out_value"),
                "fresh_total_in_count": h.get("fresh_total_in_count"),
                "fresh_total_out_count": h.get("fresh_total_out_count"),
                "fresh_outbound_counterparties": h.get("fresh_outbound_counterparties"),
                "fresh_outbound_ratio": h.get("fresh_outbound_ratio"),
                "fresh_cex_outbound_ratio": h.get("fresh_cex_outbound_ratio"),
                "fresh_cex_score": h.get("fresh_cex_score"),
                "fresh_cex_in_count": h.get("fresh_cex_in_count"),
                "fresh_cex_out_count": h.get("fresh_cex_out_count"),
                "fresh_cex_touch_count": h.get("fresh_cex_touch_count"),
                "fresh_cex_in_value": h.get("fresh_cex_in_value"),
                "fresh_cex_out_value": h.get("fresh_cex_out_value"),
                "wallet_created": h.get("wallet_created"),
                "last_flow": h.get("last_flow"),
                "last_flow_amount": h.get("last_flow_amount"),
                "cb_first_funded": h.get("cb_first_funded"),
                "cb_last_funded": h.get("cb_last_funded"),
                "cb_total_received": h.get("cb_total_received"),
                "cb_last_flow_amount": h.get("cb_last_flow_amount"),
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
        # Preserve existing labels and metadata
        if addr in label_map:
            apply_preserved_metadata(entry, label_map[addr])

        new_holders.append(entry)

    # Build balance map from existing data (to preserve balances for labeled wallets not in fresh)
    balance_map = {}
    for h in existing.get("top_holders", []):
        addr = h["address"].lower()
        balance_map[addr] = h.get("balances", {})

    # Ensure all labeled addresses are present (even if not in fresh data)
    fresh_addrs = {h["address"].lower() for h in new_holders}
    for addr, lbl in label_map.items():
        if addr not in fresh_addrs:
            # Keep labeled address with ORIGINAL balances (not empty)
            entry = {
                "address": addr,
                "balances": balance_map.get(addr, {}),
                "label": "",
                "type": ""
            }
            apply_preserved_metadata(entry, lbl)
            new_holders.append(entry)

    # Apply Whale labels: >5M ZRO, no existing label
    # Apply KNOWN_CEX labels directly
    for h in new_holders:
        addr = h["address"].lower()
        if is_locked_fresh(h):
            h["label"] = "Fresh Wallet"
            h["type"] = "FRESH"
            h["fresh"] = True
            h["label_manual"] = True
            continue

        # Enforce known CEX
        if addr in KNOWN_CEX_ADDRESSES:
            h["label"] = KNOWN_CEX_ADDRESSES[addr]
            h["type"] = "CEX"

        # Whale mapping
        total = sum(h["balances"].values())
        if total > 5_000_000 and not h["label"]:
            h["label"] = "Whale"
            h["type"] = "WHALE"

    # Sort by total balance descending
    new_holders.sort(key=lambda x: sum(x["balances"].values()), reverse=True)

    # Dedup: keep first entry per address (highest balance since sorted)
    seen_addrs = set()
    deduped = []
    for h in new_holders:
        a = h["address"].lower()
        if a not in seen_addrs:
            seen_addrs.add(a)
            deduped.append(h)
    dup_count = len(new_holders) - len(deduped)
    if dup_count:
        print(f"   🔄 Removed {dup_count} duplicate holders")
    new_holders = deduped

    # Remove zero-balance holders
    before = len(new_holders)
    new_holders = [h for h in new_holders if sum(h.get("balances", {}).values()) > 0]
    zero_rm = before - len(new_holders)
    if zero_rm:
        print(f"   🧹 Removed {zero_rm} zero-balance holders")

    # Flows: preserve existing (generated by generate_flows.py with real on-chain data)
    # Don't overwrite with fake data — generate_flows.py handles this separately
    if "flows" not in existing:
        existing["flows"] = {}

    # Update existing data structure
    existing["top_holders"] = new_holders
    synced_at = time.strftime("%Y-%m-%dT%H:%M:%SZ")
    canonical_total_supply = existing.get("meta", {}).get("total_supply") or existing.get("total_supply") or 1_000_000_000
    existing["total_supply"] = canonical_total_supply
    existing["meta"]["total_supply"] = canonical_total_supply
    existing["meta"]["generated"] = synced_at

    # Update chain holder counts from fresh data
    chain_stats = fresh.get("chain_stats", {})
    for chain_key, stats in chain_stats.items():
        if chain_key in existing.get("chains", {}):
            existing["chains"][chain_key]["holders"] = stats.get("holders_gt10", 0)
    sync_chain_snapshot_supply(existing, chain_stats, new_holders, synced_at)

    # ── Data Validation ──
    warnings = []
    errors = []

    # Check: holder count didn't drop more than 50%
    old_count = len(label_map)  # how many labeled we had
    new_count = len(new_holders)
    if old_count > 100 and new_count < old_count * 0.5:
        errors.append(f"Holder count dropped {old_count} → {new_count} (>50% drop!)")

    # Check: top holder balance sanity
    if new_holders:
        top_bal = sum(new_holders[0].get("balances", {}).values())
        if top_bal <= 0:
            errors.append(f"Top holder has 0 balance: {new_holders[0]['address']}")

    # Check: labeled wallets preserved
    new_labeled = sum(1 for h in new_holders if h.get("label"))
    old_labeled = sum(1 for v in label_map.values() if v.get("label"))
    if old_labeled > 10 and new_labeled < old_labeled * 0.8:
        warnings.append(f"Labels dropped: {old_labeled} → {new_labeled}")

    # Check: total supply sanity
    total = existing.get("total_supply", 0)
    if total <= 0:
        warnings.append("Total supply is 0")

    # Print validation results
    if warnings:
        for w in warnings:
            print(f"   ⚠️ WARNING: {w}")
    if errors:
        for e in errors:
            print(f"   ❌ ERROR: {e}")
        print("   🛑 Aborting save due to data validation errors!")
        print("   Fix the issues and re-run, or use FORCE_SAVE=1 to override")
        if not os.environ.get("FORCE_SAVE"):
            return

    save_json(data_path, existing)

    print(f"✅ Updated zro_data.json")
    print(f"   Holders: {len(new_holders)}")
    print(f"   Labeled: {new_labeled}")
    print(f"   Generated: {existing['meta']['generated']}")
    if not warnings and not errors:
        print(f"   ✅ All validation checks passed")

if __name__ == "__main__":
    main()
