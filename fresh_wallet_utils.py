#!/usr/bin/env python3
"""
Shared multi-chain helpers for Fresh Wallet detection and metadata backfill.
"""
from __future__ import annotations

import time

from utils import fetch_json


SUPPORTED_CHAINS = (
    (1, "Ethereum"),
    (42161, "Arbitrum"),
    (8453, "Base"),
    (56, "BSC"),
    (10, "Optimism"),
    (137, "Polygon"),
    (43114, "Avalanche"),
)

PRIMARY_CEX_CHAINS = (
    (1, "Ethereum"),
    (42161, "Arbitrum"),
)


def get_first_activity_timestamp_multichain(address, api_key):
    """Return the oldest on-chain activity timestamp across supported chains."""
    earliest_ts = None
    address = address.lower()

    for chain_id, _chain_name in SUPPORTED_CHAINS:
        url = (
            f"https://api.etherscan.io/v2/api?chainid={chain_id}"
            f"&module=account&action=txlist"
            f"&address={address}"
            f"&startblock=0&endblock=99999999"
            f"&page=1&offset=1&sort=asc"
            f"&apikey={api_key}"
        )
        data = fetch_json(url)
        if data and data.get("status") == "1" and data.get("result"):
            ts = int(data["result"][0].get("timeStamp", 0))
            if ts and (earliest_ts is None or ts < earliest_ts):
                earliest_ts = ts
            time.sleep(0.22)
            continue

        time.sleep(0.22)

        url2 = (
            f"https://api.etherscan.io/v2/api?chainid={chain_id}"
            f"&module=account&action=tokentx"
            f"&address={address}"
            f"&startblock=0&endblock=99999999"
            f"&page=1&offset=1&sort=asc"
            f"&apikey={api_key}"
        )
        data2 = fetch_json(url2)
        if data2 and data2.get("status") == "1" and data2.get("result"):
            ts = int(data2["result"][0].get("timeStamp", 0))
            if ts and (earliest_ts is None or ts < earliest_ts):
                earliest_ts = ts

        time.sleep(0.22)

    return earliest_ts or 0


def check_wallet_age_multichain(address, api_key, max_age_days=30):
    """Return (is_fresh, age_days, first_activity_timestamp)."""
    earliest_ts = get_first_activity_timestamp_multichain(address, api_key)
    if not earliest_ts:
        return False, 0, 0

    now = int(time.time())
    age_days = (now - earliest_ts) // 86400
    return age_days <= max_age_days, age_days, earliest_ts


def get_latest_zro_transfer_context_multichain(address, zro_contract, api_key, label_map=None, max_per_chain=20):
    """Return latest transfer context plus strongest known funding label across chains."""
    latest_ts = 0
    latest_amount = 0
    latest_chain_id = 0
    latest_chain_name = ""
    senders = {}
    label_map = {addr.lower(): label for addr, label in (label_map or {}).items()}
    address = address.lower()

    for chain_id, chain_name in SUPPORTED_CHAINS:
        url = (
            f"https://api.etherscan.io/v2/api?chainid={chain_id}"
            f"&module=account&action=tokentx"
            f"&address={address}"
            f"&contractaddress={zro_contract}"
            f"&startblock=0&endblock=99999999"
            f"&page=1&offset={max_per_chain}&sort=desc"
            f"&apikey={api_key}"
        )
        data = fetch_json(url)
        if not data or data.get("status") != "1" or not data.get("result"):
            time.sleep(0.22)
            continue

        for tx in data["result"]:
            val = int(tx.get("value", "0")) / 1e18
            if val <= 0:
                continue
            ts = int(tx.get("timeStamp", "0"))
            to_addr = tx.get("to", "").lower()
            from_addr = tx.get("from", "").lower()

            if ts > latest_ts:
                latest_ts = ts
                latest_amount = val if to_addr == address else -val
                latest_chain_id = chain_id
                latest_chain_name = chain_name

            if to_addr == address:
                label = label_map.get(from_addr)
                if label:
                    senders[label] = senders.get(label, 0) + val

        time.sleep(0.22)

    best_sender = max(senders, key=senders.get) if senders else None
    return best_sender, latest_ts, latest_amount, latest_chain_id, latest_chain_name


def analyze_cex_interactions(address, known_cex_wallets, zro_contract, api_key, max_per_chain=80, chains=None):
    """Profile CEX behavior for a young wallet.

    Freshness is determined by wallet age first. CEX activity is modeled as a
    side-profile so repeated withdrawals from a CEX do not erase the Fresh
    Wallet label by themselves. We only reject the most operational-looking
    case: heavy recycling back to CEX from the same young wallet.
    """
    address = address.lower()
    known_cex_wallets = {item.lower() for item in known_cex_wallets}
    chains = chains or PRIMARY_CEX_CHAINS
    incoming_from_cex_count = 0
    outgoing_to_cex_count = 0
    total_cex_touch_count = 0
    incoming_from_cex_value = 0.0
    outgoing_to_cex_value = 0.0
    total_inbound_count = 0
    total_outbound_count = 0
    total_inbound_value = 0.0
    total_outbound_value = 0.0
    outbound_counterparties = set()

    for chain_id, _chain_name in chains:
        url = (
            f"https://api.etherscan.io/v2/api?chainid={chain_id}"
            f"&module=account&action=tokentx"
            f"&address={address}"
            f"&contractaddress={zro_contract}"
            f"&startblock=0&endblock=99999999"
            f"&page=1&offset={max_per_chain}&sort=desc"
            f"&apikey={api_key}"
        )
        data = fetch_json(url)
        if not data or data.get("status") != "1" or not data.get("result"):
            time.sleep(0.22)
            continue

        for tx in data["result"]:
            from_addr = tx.get("from", "").lower()
            to_addr = tx.get("to", "").lower()
            value = int(tx.get("value", "0")) / 1e18

            if to_addr == address:
                total_inbound_count += 1
                total_inbound_value += value
            if from_addr == address:
                total_outbound_count += 1
                total_outbound_value += value
                if to_addr and to_addr != address:
                    outbound_counterparties.add(to_addr)

            if from_addr in known_cex_wallets or to_addr in known_cex_wallets:
                total_cex_touch_count += 1
            if from_addr in known_cex_wallets and to_addr == address:
                incoming_from_cex_count += 1
                incoming_from_cex_value += value
            if from_addr == address and to_addr in known_cex_wallets:
                outgoing_to_cex_count += 1
                outgoing_to_cex_value += value

        time.sleep(0.22)

    score = incoming_from_cex_count + (outgoing_to_cex_count * 5)
    if total_cex_touch_count >= 10:
        score += 2
    if outgoing_to_cex_count >= 10:
        score += 6
    if outgoing_to_cex_count >= 20:
        score += 10

    profile = "independent"
    profile_label = "Independent"
    reason = "independent"
    reject = False
    if outgoing_to_cex_count >= 20:
        profile = "cex_recycler"
        profile_label = "CEX recycler"
        reason = "heavy_cex_recycling"
        reject = True
    elif outgoing_to_cex_count >= 10:
        profile = "active_cex_user"
        profile_label = "Active CEX user"
        reason = "frequent_cex_deposits"
    elif outgoing_to_cex_count >= 1:
        profile = "mixed_cex_activity"
        profile_label = "Mixed CEX activity"
        reason = "light_cex_deposits"
    elif incoming_from_cex_count >= 5:
        profile = "cex_accumulator"
        profile_label = "CEX accumulator"
        reason = "repeated_cex_withdrawals"
    elif incoming_from_cex_count >= 1:
        profile = "cex_funded"
        profile_label = "CEX funded"
        reason = "cex_funded"

    return {
        "reject": reject,
        "reason": reason,
        "profile": profile,
        "profile_label": profile_label,
        "score": score,
        "incoming_from_cex_count": incoming_from_cex_count,
        "outgoing_to_cex_count": outgoing_to_cex_count,
        "total_cex_touch_count": total_cex_touch_count,
        "incoming_from_cex_value": round(incoming_from_cex_value, 4),
        "outgoing_to_cex_value": round(outgoing_to_cex_value, 4),
        "total_inbound_count": total_inbound_count,
        "total_outbound_count": total_outbound_count,
        "total_inbound_value": round(total_inbound_value, 4),
        "total_outbound_value": round(total_outbound_value, 4),
        "unique_outbound_counterparties": len(outbound_counterparties),
        "chains_checked": [chain_id for chain_id, _ in chains],
    }


def derive_fresh_signal(holder, analysis):
    """Classify a Fresh Wallet by accumulation quality, not only by age."""
    current_balance = sum((holder.get("balances") or {}).values())
    total_inbound_value = float(analysis.get("total_inbound_value", 0) or 0)
    total_outbound_value = float(analysis.get("total_outbound_value", 0) or 0)
    outgoing_to_cex_count = int(analysis.get("outgoing_to_cex_count", 0) or 0)
    outgoing_to_cex_value = float(analysis.get("outgoing_to_cex_value", 0) or 0)
    unique_outbound_counterparties = int(analysis.get("unique_outbound_counterparties", 0) or 0)

    net_accumulation = max(0.0, total_inbound_value - total_outbound_value)
    retention_ratio = 0.0
    outbound_ratio = 0.0
    cex_outbound_ratio = 0.0
    if total_inbound_value > 0:
        retention_ratio = min(2.0, current_balance / total_inbound_value)
        outbound_ratio = total_outbound_value / total_inbound_value
        cex_outbound_ratio = outgoing_to_cex_value / total_inbound_value

    signal = "fresh_wallet"
    signal_label = "Fresh wallet"
    signal_score = 40

    if (
        analysis.get("profile") == "cex_recycler"
        or (total_inbound_value > 0 and outbound_ratio >= 0.8)
        or unique_outbound_counterparties >= 12
    ):
        signal = "high_turnover"
        signal_label = "High turnover"
        signal_score = 20
    elif (
        current_balance >= 100_000
        and retention_ratio >= 0.85
        and net_accumulation >= 50_000
        and cex_outbound_ratio <= 0.15
        and unique_outbound_counterparties <= 4
    ):
        signal = "fresh_whale_accumulator"
        signal_label = "Whale accumulator"
        signal_score = 95
    elif (
        current_balance >= 50_000
        and retention_ratio >= 0.75
        and net_accumulation >= 25_000
        and cex_outbound_ratio <= 0.25
        and unique_outbound_counterparties <= 6
    ):
        signal = "fresh_accumulator"
        signal_label = "Accumulator"
        signal_score = 80
    elif (
        current_balance >= 50_000
        and retention_ratio >= 0.5
        and net_accumulation >= 10_000
    ):
        signal = "accumulator_watchlist"
        signal_label = "Accumulator watchlist"
        signal_score = 60

    return {
        "signal": signal,
        "signal_label": signal_label,
        "signal_score": signal_score,
        "retention_ratio": round(retention_ratio, 4),
        "net_accumulation": round(net_accumulation, 4),
        "total_inbound_value": round(total_inbound_value, 4),
        "total_outbound_value": round(total_outbound_value, 4),
        "total_inbound_count": int(analysis.get("total_inbound_count", 0) or 0),
        "total_outbound_count": int(analysis.get("total_outbound_count", 0) or 0),
        "outbound_counterparties": unique_outbound_counterparties,
        "outbound_ratio": round(outbound_ratio, 4),
        "cex_outbound_ratio": round(cex_outbound_ratio, 4),
    }


def apply_fresh_profile(holder, analysis):
    """Attach a normalized Fresh Wallet activity profile to the holder."""
    holder["fresh_profile"] = analysis["profile"]
    holder["fresh_profile_label"] = analysis["profile_label"]
    holder["fresh_profile_reason"] = analysis["reason"]
    holder["fresh_cex_score"] = analysis["score"]
    holder["fresh_cex_in_count"] = analysis["incoming_from_cex_count"]
    holder["fresh_cex_out_count"] = analysis["outgoing_to_cex_count"]
    holder["fresh_cex_touch_count"] = analysis["total_cex_touch_count"]
    holder["fresh_cex_in_value"] = analysis["incoming_from_cex_value"]
    holder["fresh_cex_out_value"] = analysis["outgoing_to_cex_value"]
    signal = derive_fresh_signal(holder, analysis)
    holder["fresh_signal"] = signal["signal"]
    holder["fresh_signal_label"] = signal["signal_label"]
    holder["fresh_signal_score"] = signal["signal_score"]
    holder["fresh_retention_ratio"] = signal["retention_ratio"]
    holder["fresh_net_accumulation"] = signal["net_accumulation"]
    holder["fresh_total_in_value"] = signal["total_inbound_value"]
    holder["fresh_total_out_value"] = signal["total_outbound_value"]
    holder["fresh_total_in_count"] = signal["total_inbound_count"]
    holder["fresh_total_out_count"] = signal["total_outbound_count"]
    holder["fresh_outbound_counterparties"] = signal["outbound_counterparties"]
    holder["fresh_outbound_ratio"] = signal["outbound_ratio"]
    holder["fresh_cex_outbound_ratio"] = signal["cex_outbound_ratio"]
    return holder


def has_cex_interaction_multichain(address, known_cex_wallets, zro_contract, api_key, max_per_chain=80, chains=None):
    """Compatibility wrapper returning only the final reject decision."""
    return analyze_cex_interactions(
        address,
        known_cex_wallets,
        zro_contract,
        api_key,
        max_per_chain=max_per_chain,
        chains=chains,
    )["reject"]
