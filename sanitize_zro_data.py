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

from cex_addresses import KNOWN_CEX_ADDRESSES
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


def is_flow_infrastructure(flow_type):
    return flow_type in FLOW_INFRA_TYPES


def derive_flow_cohort(label, flow_type, address=""):
    label_lower = (label or "").lower()
    flow_type = (flow_type or "").upper()
    cex_name = KNOWN_CEX_ADDRESSES.get((address or "").lower(), "")
    if "coinbase" in label_lower or "coinbase" in cex_name.lower():
        return "coinbase"
    if flow_type in STRATEGIC_FLOW_TYPES:
        return "strategic"
    if any(token in label_lower for token in ("investment recipient", "borderless capital", "strategic")):
        return "strategic"
    return "organic"


def get_flow_net_retention_ratio(item):
    total_in = float(item.get("total_in") or 0)
    if total_in <= 0:
        return 0
    return float(item.get("net_flow") or 0) / total_in


def get_flow_balance_share(item):
    balance = float(item.get("balance") or 0)
    if balance <= 0:
        return 0
    return abs(float(item.get("net_flow") or 0)) / balance


def derive_seller_profile(item):
    existing = item.get("seller_profile")
    if existing:
        return existing
    cohort = derive_flow_cohort(item.get("label"), item.get("type"), item.get("address"))
    if cohort == "coinbase":
        return "coinbase_rotation"
    if cohort == "strategic":
        return "strategic_rotation"
    return "unresolved_outflow"


def derive_accumulation_source(item, holder=None):
    existing = item.get("accumulation_source")
    if existing:
        return existing
    holder = holder or {}
    funded_by = (item.get("funded_by") or holder.get("funded_by") or "").lower()
    fresh_profile = (item.get("fresh_profile") or holder.get("fresh_profile") or "").lower()
    if "coinbase" in funded_by:
        return "coinbase_funded"
    if funded_by or fresh_profile == "cex_funded":
        return "cex_funded"
    cohort = derive_flow_cohort(item.get("label"), item.get("type"), item.get("address"))
    if cohort == "strategic":
        return "strategic_inflow"
    return "mixed_inflow" if item.get("net_flow", 0) > 0 else "unresolved_inflow"


def derive_fresh_flow_signal(item, holder=None):
    existing = item.get("fresh_flow_signal")
    if existing:
        return existing
    holder = holder or {}
    is_fresh = (
        item.get("fresh_overlap") is True
        or item.get("type") == "FRESH"
        or item.get("label") == "Fresh Wallet"
        or holder.get("type") == "FRESH"
        or holder.get("label") == "Fresh Wallet"
        or holder.get("fresh") is True
    )
    if not is_fresh:
        return ""
    if float(item.get("net_flow") or 0) < 0:
        return "fresh_seller"
    fresh_signal = item.get("fresh_signal") or holder.get("fresh_signal") or ""
    if fresh_signal in {"fresh_whale_accumulator", "fresh_accumulator"}:
        return fresh_signal
    return "fresh_wallet"


def derive_sell_pressure_score(item):
    existing = item.get("sell_pressure_score")
    if existing not in (None, ""):
        return round(float(existing), 2)
    balance_share = get_flow_balance_share(item)
    cex_ratio = float(item.get("cex_outflow_ratio") or 0)
    external_ratio = float(item.get("external_outflow_ratio") or 0)
    pressure = 1 + (min(balance_share, 0.25) * 4.0) + (min(cex_ratio, 1) * 0.9) + (min(external_ratio, 1) * 0.35)
    seller_profile = derive_seller_profile(item)
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
    if derive_fresh_flow_signal(item):
        pressure += 0.08
    return round(abs(float(item.get("net_flow") or 0)) * pressure, 2)


def derive_flow_score(item):
    balance_share = get_flow_balance_share(item)
    if item["net_flow"] > 0:
        retention = max(0, min(float(item.get("retention_ratio") or 0), 2))
        net_retention = max(0, min(get_flow_net_retention_ratio(item), 1.5))
        conviction = 1 + (retention * 0.35) + (net_retention * 0.55) + (min(balance_share, 0.25) * 2.5)
        fresh_signal = derive_fresh_flow_signal(item)
        accumulation_source = derive_accumulation_source(item)
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


def is_meaningful_accumulator(item):
    retention_ratio = float(item.get("retention_ratio") or 0)
    net_retention_ratio = get_flow_net_retention_ratio(item)
    balance_share = get_flow_balance_share(item)
    min_balance = max(FLOW_MIN_BALANCE, abs(item["net_flow"]) * FLOW_MIN_RETENTION)
    keeps_meaningful_balance = retention_ratio >= FLOW_MIN_RETENTION or item["balance"] >= min_balance
    meaningful_period_signal = (
        item["net_flow"] >= FLOW_MIN_BALANCE
        or net_retention_ratio >= FLOW_MIN_NET_RETENTION
        or balance_share >= FLOW_MIN_BALANCE_SHARE
    )
    return item["net_flow"] > 0 and keeps_meaningful_balance and meaningful_period_signal


def is_meaningful_seller(item):
    abs_net_flow = abs(float(item.get("net_flow") or 0))
    balance_share = get_flow_balance_share(item)
    return item["net_flow"] < 0 and (abs_net_flow >= FLOW_MIN_BALANCE or balance_share >= FLOW_MIN_SELL_BALANCE_SHARE)


def normalize_flow_item(raw_item, holder_map):
    address = raw_item.get("address", "").lower()
    if not address:
        return None, "invalid"

    holder = holder_map.get(address)
    if not holder:
        return None, "untracked"

    label = raw_item.get("label") or holder.get("label", "")
    flow_type = raw_item.get("type") or holder.get("type", "")
    balance = round(float(raw_item.get("balance") or holder_total(holder) or 0))
    net_flow = round(float(raw_item.get("net_flow") or 0))

    if net_flow == 0 or balance <= 0:
        return None, "stale"
    if is_flow_infrastructure(flow_type):
        return None, "infrastructure"

    total_in = float(raw_item.get("total_in") or 0)
    total_out = float(raw_item.get("total_out") or 0)
    retention_ratio = raw_item.get("retention_ratio")
    if retention_ratio in (None, "") and net_flow > 0:
        base = total_in if total_in > 0 else abs(net_flow)
        if base > 0:
            retention_ratio = round(balance / base, 4)

    normalized = {
        "address": address,
        "label": label,
        "type": flow_type,
        "net_flow": net_flow,
        "balance": balance,
    }
    if holder.get("funded_by"):
        normalized["funded_by"] = holder["funded_by"]
    if holder.get("fresh_profile"):
        normalized["fresh_profile"] = holder["fresh_profile"]
    if holder.get("fresh_signal"):
        normalized["fresh_signal"] = holder["fresh_signal"]
    flow_cohort = raw_item.get("flow_cohort") or derive_flow_cohort(label, flow_type, address)
    normalized["flow_cohort"] = flow_cohort
    normalized["flow_cohort_label"] = raw_item.get("flow_cohort_label") or FLOW_COHORT_LABELS[flow_cohort]
    if total_in > 0:
        normalized["total_in"] = round(total_in)
    if total_out > 0:
        normalized["total_out"] = round(total_out)
    if retention_ratio not in (None, ""):
        normalized["retention_ratio"] = round(float(retention_ratio), 4)

    flow_chains = raw_item.get("flow_chains")
    if isinstance(flow_chains, list) and flow_chains:
        normalized["flow_chains"] = sorted({chain for chain in flow_chains if chain})
    elif raw_item.get("chain"):
        normalized["flow_chains"] = [raw_item["chain"]]
    primary_chain = raw_item.get("primary_flow_chain")
    if primary_chain:
        normalized["primary_flow_chain"] = primary_chain
    elif normalized.get("flow_chains"):
        normalized["primary_flow_chain"] = normalized["flow_chains"][0]
    else:
        normalized["chain_unresolved"] = True

    fresh_flow_signal = derive_fresh_flow_signal(raw_item, holder)
    if fresh_flow_signal:
        normalized["fresh_overlap"] = True
        normalized["fresh_flow_signal"] = fresh_flow_signal
        normalized["fresh_flow_label"] = raw_item.get("fresh_flow_label") or FRESH_FLOW_LABELS[fresh_flow_signal]

    if net_flow > 0:
        accumulation_source = derive_accumulation_source(raw_item, holder)
        normalized["accumulation_source"] = accumulation_source
        normalized["accumulation_source_label"] = raw_item.get("accumulation_source_label") or ACCUMULATION_SOURCE_LABELS[accumulation_source]

    if net_flow < 0:
        seller_profile = derive_seller_profile(raw_item)
        normalized["seller_profile"] = seller_profile
        normalized["seller_profile_label"] = raw_item.get("seller_profile_label") or SELLER_PROFILE_LABELS[seller_profile]
        if raw_item.get("cex_outflow_ratio") not in (None, ""):
            normalized["cex_outflow_ratio"] = round(float(raw_item["cex_outflow_ratio"]), 4)
        if raw_item.get("external_outflow_ratio") not in (None, ""):
            normalized["external_outflow_ratio"] = round(float(raw_item["external_outflow_ratio"]), 4)
        normalized["sell_pressure_score"] = derive_sell_pressure_score({**raw_item, **normalized})

    normalized["flow_score"] = round(float(raw_item.get("flow_score") or derive_flow_score(normalized)), 2)

    return normalized, "ok"


def normalize_flows(data):
    holder_map = {holder["address"].lower(): holder for holder in data.get("top_holders", [])}
    flow_summary = {}

    for period_key, flow_bucket in (data.get("flows") or {}).items():
        summary = {
            "raw_accumulators": len(flow_bucket.get("accumulators", [])),
            "raw_sellers": len(flow_bucket.get("sellers", [])),
            "excluded_untracked": 0,
            "excluded_infrastructure": 0,
            "excluded_zero_balance": 0,
            "excluded_low_retention": 0,
            "excluded_low_signal": 0,
            "chain_unresolved_rows": 0,
        }
        accumulators = []
        sellers = []

        for raw_item in flow_bucket.get("accumulators", []):
            item, reason = normalize_flow_item(raw_item, holder_map)
            if reason == "untracked":
                summary["excluded_untracked"] += 1
                continue
            if reason == "infrastructure":
                summary["excluded_infrastructure"] += 1
                continue
            if reason != "ok":
                summary["excluded_zero_balance"] += 1
                continue

            if item.get("chain_unresolved"):
                summary["chain_unresolved_rows"] += 1
            if not is_meaningful_accumulator(item):
                summary["excluded_low_retention"] += 1
                continue
            accumulators.append(item)

        for raw_item in flow_bucket.get("sellers", []):
            item, reason = normalize_flow_item(raw_item, holder_map)
            if reason == "untracked":
                summary["excluded_untracked"] += 1
                continue
            if reason == "infrastructure":
                summary["excluded_infrastructure"] += 1
                continue
            if reason != "ok":
                summary["excluded_zero_balance"] += 1
                continue
            if item.get("chain_unresolved"):
                summary["chain_unresolved_rows"] += 1
            if not is_meaningful_seller(item):
                summary["excluded_low_signal"] += 1
                continue
            sellers.append(item)

        accumulators.sort(key=lambda item: (item.get("flow_score", 0), item["net_flow"], item.get("retention_ratio", 0), item["balance"]), reverse=True)
        sellers.sort(key=lambda item: (item.get("sell_pressure_score", item.get("flow_score", 0)), abs(item["net_flow"]), -item["balance"]), reverse=True)

        flow_bucket["accumulators"] = accumulators
        flow_bucket["sellers"] = sellers
        summary["normalized_accumulators"] = len(accumulators)
        summary["normalized_sellers"] = len(sellers)
        flow_bucket["meta"] = summary
        flow_summary[period_key] = summary

    return flow_summary


def choose_preferred_whale_record(existing, candidate):
    existing_score = (
        bool(existing.get("event_id")),
        bool(existing.get("log_index") not in (None, "")),
        abs(float(existing.get("value") or 0)),
        bool(existing.get("from_label")),
        bool(existing.get("to_label")),
    )
    candidate_score = (
        bool(candidate.get("event_id")),
        bool(candidate.get("log_index") not in (None, "")),
        abs(float(candidate.get("value") or 0)),
        bool(candidate.get("from_label")),
        bool(candidate.get("to_label")),
    )
    return candidate if candidate_score > existing_score else existing


def build_whale_event_id(item):
    tx_hash = (item.get("tx_hash") or "").lower()
    log_index = item.get("log_index")
    if tx_hash and log_index not in (None, ""):
        return f"{tx_hash}:{log_index}"
    from_addr = (item.get("from") or "").lower()
    to_addr = (item.get("to") or "").lower()
    timestamp = int(item.get("timestamp") or 0)
    transfer_type = item.get("type") or "TRANSFER"
    return f"{tx_hash}:{from_addr}:{to_addr}:{timestamp}:{transfer_type}"


def normalize_whale_transfers(data):
    holder_map = {holder["address"].lower(): holder for holder in data.get("top_holders", [])}
    summary = {
        "raw_rows": len(data.get("whale_transfers", [])),
        "deduplicated_rows": 0,
        "removed_cex_to_cex": 0,
        "reclassified_rows": 0,
        "removed_below_threshold": 0,
        "normalized_rows": 0,
    }
    deduped = {}

    for raw_item in data.get("whale_transfers", []):
        tx_hash = (raw_item.get("tx_hash") or "").lower()
        from_addr = (raw_item.get("from") or "").lower()
        to_addr = (raw_item.get("to") or "").lower()
        if not tx_hash or not from_addr or not to_addr:
            continue

        value = round(float(raw_item.get("value") or 0), 2)
        if value < 100_000:
            summary["removed_below_threshold"] += 1
            continue

        from_is_cex = from_addr in KNOWN_CEX_ADDRESSES
        to_is_cex = to_addr in KNOWN_CEX_ADDRESSES
        if from_is_cex and to_is_cex:
            summary["removed_cex_to_cex"] += 1
            continue

        transfer_type = "CEX_WITHDRAWAL" if from_is_cex else "CEX_DEPOSIT" if to_is_cex else "TRANSFER"
        if transfer_type != raw_item.get("type"):
            summary["reclassified_rows"] += 1

        normalized = {
            "tx_hash": tx_hash,
            "from": from_addr,
            "to": to_addr,
            "value": value,
            "timestamp": int(raw_item.get("timestamp") or 0),
            "type": transfer_type,
            "from_label": KNOWN_CEX_ADDRESSES.get(from_addr)
            or holder_map.get(from_addr, {}).get("label")
            or raw_item.get("from_label")
            or from_addr,
            "to_label": KNOWN_CEX_ADDRESSES.get(to_addr)
            or holder_map.get(to_addr, {}).get("label")
            or raw_item.get("to_label")
            or to_addr,
        }
        if raw_item.get("log_index") not in (None, ""):
            normalized["log_index"] = raw_item.get("log_index")
        normalized["event_id"] = raw_item.get("event_id") or build_whale_event_id(normalized)

        event_id = normalized["event_id"]
        if event_id in deduped:
            summary["deduplicated_rows"] += 1
            deduped[event_id] = choose_preferred_whale_record(deduped[event_id], normalized)
            continue
        deduped[event_id] = normalized

    normalized_rows = sorted(deduped.values(), key=lambda item: item.get("timestamp", 0))
    summary["normalized_rows"] = len(normalized_rows)
    data["whale_transfers"] = normalized_rows[-500:]
    return summary


def build_integrity_report(data, duplicate_records_removed, flow_summary, whale_summary):
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
        "flow_diagnostics": flow_summary,
        "whale_transfer_diagnostics": whale_summary,
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
    flow_summary = normalize_flows(data)
    whale_summary = normalize_whale_transfers(data)
    data.setdefault("meta", {})
    data["meta"]["integrity"] = build_integrity_report(data, duplicate_records_removed, flow_summary, whale_summary)

    integrity = data["meta"]["integrity"]
    anomaly_count = len(integrity["chain_balance_anomalies"])

    print("🧽 ZRO dataset normalized")
    print(f"   Holders: {len(deduped_holders)}")
    print(f"   Duplicate holder records removed: {duplicate_records_removed}")
    print(f"   Fresh wallets missing created date: {integrity['fresh_wallets_missing_created']}")
    print(f"   Fresh wallets missing last flow: {integrity['fresh_wallets_missing_last_flow']}")
    print(f"   Chain balance anomalies: {anomaly_count}")
    print(f"   Whale rows normalized: {whale_summary['normalized_rows']}")
    print(f"   Whale rows deduplicated: {whale_summary['deduplicated_rows']}")
    print(f"   Whale CEX→CEX rows removed: {whale_summary['removed_cex_to_cex']}")

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
