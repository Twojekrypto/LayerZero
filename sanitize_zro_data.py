#!/usr/bin/env python3
"""
Normalize zro_data.json so the dashboard has a consistent local snapshot.

What this script does:
- deduplicates top_holders by address
- preserves the richest metadata when duplicates exist
- fills missing fresh wallet creation timestamps from fresh_cache.json when available
- stores integrity diagnostics under meta.integrity for the frontend/tests
"""
from __future__ import annotations

import argparse
import json
import os
import time
from collections import defaultdict
from copy import deepcopy

from utils import atomic_json_dump


DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(DIR, "zro_data.json")
FRESH_CACHE_PATH = os.path.join(DIR, "fresh_cache.json")

METADATA_KEYS = (
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
)


def load_json(path):
    with open(path) as handle:
        return json.load(handle)


def holder_total(holder):
    return sum((holder.get("balances") or {}).values())


def holder_score(holder):
    score = 0
    if holder.get("label_manual"):
        score += 100
    if holder.get("label"):
        score += 20
    if holder.get("type"):
        score += 10
    score += sum(1 for key in METADATA_KEYS if holder.get(key) not in (None, "", False))
    score += holder_total(holder) / 1_000_000_000
    return score


def choose_latest_flow(records, field_name):
    candidates = []
    for record in records:
        ts = record.get(field_name)
        if ts in (None, "", 0):
            continue
        candidates.append((ts, record))
    if not candidates:
        return None, None
    ts, record = max(candidates, key=lambda item: item[0])
    amount_key = "last_flow_amount" if field_name == "last_flow" else "cb_last_flow_amount"
    return ts, record.get(amount_key)


def is_fresh_holder(holder):
    return holder.get("type") == "FRESH" or holder.get("label") == "Fresh Wallet" or holder.get("fresh") is True


def merge_holders(records, fresh_cache):
    ranked = sorted(records, key=holder_score, reverse=True)
    merged = deepcopy(ranked[0])
    addr = ranked[0]["address"].lower()
    merged["address"] = addr
    had_fresh_label = any(is_fresh_holder(record) for record in ranked)

    balances = defaultdict(float)
    for record in ranked:
        for chain, value in (record.get("balances") or {}).items():
            balances[chain] = max(balances[chain], float(value or 0))
    merged["balances"] = {chain: round(value, 8) for chain, value in balances.items() if value > 0}

    best_signal_record = None
    signal_candidates = [record for record in ranked if record.get("fresh_signal") or record.get("fresh_signal_label")]
    if signal_candidates:
        best_signal_record = max(signal_candidates, key=lambda record: float(record.get("fresh_signal_score", 0) or 0))
        if best_signal_record.get("fresh_signal"):
            merged["fresh_signal"] = best_signal_record["fresh_signal"]
        if best_signal_record.get("fresh_signal_label"):
            merged["fresh_signal_label"] = best_signal_record["fresh_signal_label"]

    for key in (
        "label",
        "type",
        "funded_by",
        "fresh_profile",
        "fresh_profile_label",
        "fresh_profile_reason",
    ):
        if merged.get(key):
            continue
        for record in ranked:
            if record.get(key):
                merged[key] = record[key]
                break

    for key in (
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
    ):
        values = [record.get(key) for record in ranked if record.get(key) not in (None, "")]
        if values:
            merged[key] = max(values)

    if any(record.get("label_manual") for record in ranked):
        merged["label_manual"] = True

    wallet_created_values = [record.get("wallet_created") for record in ranked if record.get("wallet_created")]
    if wallet_created_values:
        merged["wallet_created"] = min(wallet_created_values)
    elif had_fresh_label or merged.get("type") in ("FRESH", "NEW_INST"):
        cache_first_ts = fresh_cache.get(addr, {}).get("first_ts")
        if cache_first_ts:
            merged["wallet_created"] = cache_first_ts

    last_flow_ts, last_flow_amount = choose_latest_flow(ranked, "last_flow")
    if last_flow_ts:
        merged["last_flow"] = last_flow_ts
        merged["last_flow_amount"] = last_flow_amount

    cb_first_values = [record.get("cb_first_funded") for record in ranked if record.get("cb_first_funded")]
    if cb_first_values:
        merged["cb_first_funded"] = min(cb_first_values)

    cb_last_ts, cb_last_amount = choose_latest_flow(ranked, "cb_last_funded")
    if cb_last_ts:
        merged["cb_last_funded"] = cb_last_ts
        merged["cb_last_flow_amount"] = cb_last_amount

    cb_total_values = [record.get("cb_total_received") for record in ranked if record.get("cb_total_received") not in (None, "")]
    if cb_total_values:
        merged["cb_total_received"] = max(cb_total_values)

    if had_fresh_label:
        merged["label"] = "Fresh Wallet"
        merged["type"] = "FRESH"
        merged["fresh"] = True
        merged["label_manual"] = True
    if merged.get("type") == "NEW_INST" and not merged.get("label"):
        merged["label"] = "New Institutional"

    return merged


def normalize_holders(data, fresh_cache):
    grouped = defaultdict(list)
    for holder in data.get("top_holders", []):
        address = holder.get("address", "").lower()
        if not address:
            continue
        grouped[address].append(holder)

    deduped = [merge_holders(records, fresh_cache) for records in grouped.values()]
    deduped = [holder for holder in deduped if holder_total(holder) > 0]
    deduped.sort(key=holder_total, reverse=True)

    removed = len(data.get("top_holders", [])) - len(deduped)
    return deduped, removed


def build_integrity_report(data, duplicate_records_removed):
    holders = data.get("top_holders", [])
    chain_totals = {chain: 0 for chain in data.get("chains", {})}
    for holder in holders:
        for chain, value in (holder.get("balances") or {}).items():
            if chain in chain_totals:
                chain_totals[chain] += float(value or 0)

    chain_balance_anomalies = []
    for chain_key, chain_config in data.get("chains", {}).items():
        configured = float(chain_config.get("supply", 0) or 0)
        tracked = round(chain_totals.get(chain_key, 0), 8)
        if configured > 0 and tracked > configured * 1.005:
            chain_balance_anomalies.append({
                "chain": chain_key,
                "configured_supply": round(configured, 8),
                "tracked_balance": tracked,
                "overage": round(tracked - configured, 8),
            })

    fresh_wallets = [holder for holder in holders if holder.get("type") == "FRESH" or holder.get("fresh") is True]
    integrity = {
        "normalized_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "duplicate_holder_records_removed": duplicate_records_removed,
        "fresh_wallets_missing_created": sum(1 for holder in fresh_wallets if not holder.get("wallet_created")),
        "fresh_wallets_missing_last_flow": sum(1 for holder in fresh_wallets if not holder.get("last_flow")),
        "tracked_chain_balances": {chain: round(total, 8) for chain, total in chain_totals.items()},
        "chain_balance_anomalies": chain_balance_anomalies,
    }
    return integrity


def parse_args():
    parser = argparse.ArgumentParser(description="Normalize local zro_data.json.")
    parser.add_argument("--check", action="store_true", help="Validate and print diagnostics without writing the file.")
    parser.add_argument(
        "--fail-on-anomaly",
        action="store_true",
        help="Exit with code 1 when integrity anomalies remain after normalization.",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    data = load_json(DATA_PATH)
    fresh_cache = load_json(FRESH_CACHE_PATH) if os.path.exists(FRESH_CACHE_PATH) else {}

    deduped_holders, duplicate_records_removed = normalize_holders(data, fresh_cache)
    data["top_holders"] = deduped_holders
    data.setdefault("meta", {})
    data["meta"]["integrity"] = build_integrity_report(data, duplicate_records_removed)

    integrity = data["meta"]["integrity"]
    anomaly_count = len(integrity["chain_balance_anomalies"])

    print("🧽 ZRO dataset normalized")
    print(f"   Holders: {len(deduped_holders)}")
    print(f"   Duplicate holder records removed: {duplicate_records_removed}")
    print(f"   Fresh wallets missing created date: {integrity['fresh_wallets_missing_created']}")
    print(f"   Fresh wallets missing last flow: {integrity['fresh_wallets_missing_last_flow']}")
    print(f"   Chain balance anomalies: {anomaly_count}")

    if integrity["chain_balance_anomalies"]:
        for anomaly in integrity["chain_balance_anomalies"]:
            print(
                "   ⚠️ "
                f"{anomaly['chain']}: tracked {anomaly['tracked_balance']:,.2f} "
                f"> configured {anomaly['configured_supply']:,.2f} "
                f"(over by {anomaly['overage']:,.2f})"
            )

    if not args.check:
        atomic_json_dump(data, DATA_PATH)
        print(f"   Saved: {DATA_PATH}")

    if args.fail_on_anomaly and (duplicate_records_removed > 0 or anomaly_count > 0):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
