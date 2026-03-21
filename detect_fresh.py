#!/usr/bin/env python3
"""
Auto-detect Fresh & New Institutional Wallets.
For every ZRO holder with >10K balance that has no label yet,
check Etherscan for their wallet creation date (first TX or contract creation).

Detection logic:
  1. Skip already-labeled wallets (CEX, FRESH, UNLOCK, CUSTODY, etc.)
  2. For CONTRACTS: check contract creation timestamp (not first exec TX!)
     - If deployed by known institutional deployer → label NEW_INST
     - Otherwise → label FRESH
  3. For EOAs: check first-ever transaction timestamp → label FRESH
  4. Only wallets created in last 30 days qualify
"""
import json, os, time
from urllib.request import urlopen, Request

API_KEY = os.environ.get("ETHERSCAN_API_KEY", "")
DISCORD_WEBHOOK_URL = os.environ.get("DISCORD_WEBHOOK_URL", "")
MIN_BALANCE_FOR_CHECK = 10_000  # Only check wallets with >10K ZRO
FRESH_AGE_DAYS = 30  # Wallet younger than this = FRESH

# Known multi-sig deployers — wallets created by these are institutional
KNOWN_DEPLOYERS = {
    "0x5e2e302ba028f33845fcb107dd8a6b55f42e92a0",  # BitGo deployer
    "0x41274f7674333a7e5b3215e4c7af51eb4cc7cedb",  # Gnosis Safe deployer (LZ)
}

DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(DIR, "zro_data.json")
CACHE_PATH = os.path.join(DIR, "fresh_cache.json")


def load_cache():
    """Load cached wallet age results to avoid redundant API calls."""
    if os.path.exists(CACHE_PATH):
        with open(CACHE_PATH) as f:
            return json.load(f)
    return {}


def save_cache(cache):
    """Save wallet age cache."""
    with open(CACHE_PATH, "w") as f:
        json.dump(cache, f, indent=2)


def fetch_json(url):
    for attempt in range(3):
        try:
            req = Request(url, headers={"User-Agent": "ZRO-Dashboard/1.0"})
            with urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode())
        except Exception as e:
            print(f"  ⚠️ Attempt {attempt+1} failed: {e}")
            time.sleep(2)
    return None


def is_contract(address):
    """Check if an address is a contract (has code) via Etherscan."""
    url = (
        f"https://api.etherscan.io/v2/api?chainid=1"
        f"&module=proxy&action=eth_getCode"
        f"&address={address}&tag=latest"
        f"&apikey={API_KEY}"
    )
    data = fetch_json(url)
    if data and data.get("result"):
        code = data["result"]
        return code != "0x" and len(code) > 2
    return False


def get_contract_creation_timestamp(address):
    """Get the contract creation timestamp.
    Uses the contract creation TX to determine when the contract was deployed."""
    url = (
        f"https://api.etherscan.io/v2/api?chainid=1"
        f"&module=contract&action=getcontractcreation"
        f"&contractaddresses={address}"
        f"&apikey={API_KEY}"
    )
    data = fetch_json(url)
    if data and data.get("status") == "1" and data.get("result"):
        result = data["result"][0]
        deployer = result.get("contractCreator", "").lower()
        tx_hash = result.get("txHash", "")

        # Check if deployer is known institutional deployer
        if deployer in KNOWN_DEPLOYERS:
            return None, deployer  # Skip — institutional contract

        # Get the TX timestamp
        if tx_hash:
            tx_url = (
                f"https://api.etherscan.io/v2/api?chainid=1"
                f"&module=proxy&action=eth_getTransactionByHash"
                f"&txhash={tx_hash}"
                f"&apikey={API_KEY}"
            )
            # Use block receipt for timestamp
            receipt_url = (
                f"https://api.etherscan.io/v2/api?chainid=1"
                f"&module=transaction&action=gettxreceiptstatus"
                f"&txhash={tx_hash}"
                f"&apikey={API_KEY}"
            )
            # Better: get the block number from tx and then block timestamp
            tx_data = fetch_json(tx_url)
            if tx_data and tx_data.get("result"):
                block_hex = tx_data["result"].get("blockNumber", "0x0")
                block_num = int(block_hex, 16)
                time.sleep(0.25)
                block_url = (
                    f"https://api.etherscan.io/v2/api?chainid=1"
                    f"&module=block&action=getblockreward"
                    f"&blockno={block_num}"
                    f"&apikey={API_KEY}"
                )
                block_data = fetch_json(block_url)
                if block_data and block_data.get("result"):
                    return int(block_data["result"].get("timeStamp", 0)), deployer

    return None, None


KNOWN_CEX_HOT_WALLETS = {
    # Coinbase
    "0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43",
    "0x503828976d22510aad0201ac7ec88293211d23da",
    "0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740",
    "0x3cd751e6b0078be393132286c442345e68ff0afc",
    "0xb5d85cbf7cb3ee0d56b3bb207d5fc4b82f43f511",
    "0xeb2629a2734e272bcc07bda959863f316f4bd4cf",
    # Binance
    "0x28c6c06298d514db089934071355e5743bf21d60",
    "0x21a31ee1afc51d94c2efccaa2092ad1028285549",
    "0xdfd5293d8e347dfe59e90efd55b2956a1343963d",
    "0x56eddb7aa87536c09ccc2793473599fd21a8b17f",
    # OKX
    "0x6cc5f688a315f3dc28a7781717a9a798a59fda7b",
    "0x236f9f97e0e62388479bf9e5ba4889e46b0273c3",
    # Bybit
    "0xf89d7b9c864f589bbf53a82105107622b35eaa40",
    "0x1db92e2eebc8e0c075a02bea49a2935bcd2dfcf4",
}


def get_first_tx_timestamp_multichain(address):
    """Get the EARLIEST first transaction across ALL supported chains.
    Returns the oldest first-tx timestamp found on any chain."""
    # Chains to check: chainid values
    chains_to_check = [
        (1, "Ethereum"),
        (42161, "Arbitrum"),
        (8453, "Base"),
        (56, "BSC"),
        (10, "Optimism"),
        (137, "Polygon"),
        (43114, "Avalanche"),
    ]

    earliest_ts = None

    for chain_id, chain_name in chains_to_check:
        # Check normal transactions first
        url = (
            f"https://api.etherscan.io/v2/api?chainid={chain_id}"
            f"&module=account&action=txlist"
            f"&address={address}"
            f"&startblock=0&endblock=99999999"
            f"&page=1&offset=1&sort=asc"
            f"&apikey={API_KEY}"
        )
        data = fetch_json(url)
        if data and data.get("status") == "1" and data.get("result"):
            ts = int(data["result"][0].get("timeStamp", 0))
            if ts and (earliest_ts is None or ts < earliest_ts):
                earliest_ts = ts
            time.sleep(0.22)
            continue

        time.sleep(0.22)

        # Fallback: check token transactions
        url2 = (
            f"https://api.etherscan.io/v2/api?chainid={chain_id}"
            f"&module=account&action=tokentx"
            f"&address={address}"
            f"&startblock=0&endblock=99999999"
            f"&page=1&offset=1&sort=asc"
            f"&apikey={API_KEY}"
        )
        data2 = fetch_json(url2)
        if data2 and data2.get("status") == "1" and data2.get("result"):
            ts = int(data2["result"][0].get("timeStamp", 0))
            if ts and (earliest_ts is None or ts < earliest_ts):
                earliest_ts = ts

        time.sleep(0.22)

    return earliest_ts


def has_cex_interaction(address):
    """Check if a wallet has direct ZRO transfers to/from known CEX hot wallets.
    If so, this is likely a CEX deposit wallet, not an independent fresh buyer."""
    url = (
        f"https://api.etherscan.io/v2/api?chainid=1"
        f"&module=account&action=tokentx"
        f"&address={address}"
        f"&contractaddress=0x6985884c4392d348587b19cb9eaaf157f13271cd"
        f"&startblock=0&endblock=99999999"
        f"&page=1&offset=50&sort=desc"
        f"&apikey={API_KEY}"
    )
    data = fetch_json(url)
    if not data or data.get("status") != "1" or not data.get("result"):
        return False

    cex_interactions = 0
    for tx in data["result"]:
        from_addr = tx.get("from", "").lower()
        to_addr = tx.get("to", "").lower()
        if from_addr in KNOWN_CEX_HOT_WALLETS or to_addr in KNOWN_CEX_HOT_WALLETS:
            cex_interactions += 1

    # If 2+ interactions with CEX → likely a CEX-related wallet
    return cex_interactions >= 2


def main():
    if not API_KEY:
        print("❌ ETHERSCAN_API_KEY not set")
        return

    with open(DATA_PATH) as f:
        data = json.load(f)

    now = int(time.time())
    cutoff = now - (FRESH_AGE_DAYS * 86400)

    # Get existing labeled addresses (skip these)
    already_labeled = set()
    for h in data["top_holders"]:
        addr = h["address"].lower()
        if h.get("label"):
            already_labeled.add(addr)

    # Find candidates: >10K ZRO, no existing label
    candidates = []
    for h in data["top_holders"]:
        addr = h["address"].lower()
        if addr in already_labeled:
            continue
        total = sum(h.get("balances", {}).values())
        if total >= MIN_BALANCE_FOR_CHECK:
            candidates.append(h)

    print(f"🔍 Fresh Wallet Detection (improved)")
    print(f"   Already labeled (skip): {len(already_labeled)}")
    print(f"   Candidates to check: {len(candidates)}")
    print(f"   Cutoff date: {time.strftime('%Y-%m-%d', time.gmtime(cutoff))}")
    print()

    if not candidates:
        print("✅ No new candidates to check")
        return

    new_fresh = 0
    new_inst = 0
    skipped_contracts = 0
    checked = 0
    cache_hits = 0
    new_wallets = []  # Collect for Discord alerts

    # Load cache of already-checked wallets
    cache = load_cache()
    now_ts = now

    for h in candidates:
        addr = h["address"].lower()
        total = sum(h.get("balances", {}).values())
        checked += 1

        # Check cache first
        cached = cache.get(addr)
        if cached:
            result = cached.get("result")  # OLD, FRESH, NEW_INST, SKIP
            # OLD wallets stay OLD forever
            if result == "OLD":
                cache_hits += 1
                continue
            # FRESH/NEW_INST: re-check if they've aged out (>30 days since first_ts)
            first_ts = cached.get("first_ts", 0)
            if first_ts and (now_ts - first_ts) > (FRESH_AGE_DAYS * 86400):
                # Aged out — remove label and mark as OLD
                cache[addr] = {"result": "OLD", "checked": now_ts}
                if h.get("type") in ("FRESH", "NEW_INST") and not h.get("label_manual"):
                    h.pop("label", None)
                    h.pop("type", None)
                cache_hits += 1
                continue
            elif result in ("FRESH", "NEW_INST"):
                # Still fresh — keep existing label, skip API call
                cache_hits += 1
                continue
            # SKIP results: re-check periodically (every 7 days)
            if result == "SKIP" and (now_ts - cached.get("checked", 0)) < 7 * 86400:
                cache_hits += 1
                continue

        try:
            # Step 1: Check if it's a contract
            contract = is_contract(addr)
            time.sleep(0.25)

            if contract:
                # For contracts: check creation date and deployer
                creation_ts, deployer = get_contract_creation_timestamp(addr)
                time.sleep(0.25)

                if creation_ts and creation_ts > cutoff:
                    wallet_age = (now - creation_ts) // 86400
                    if deployer and deployer in KNOWN_DEPLOYERS:
                        h["label"] = "New Institutional"
                        h["type"] = "NEW_INST"
                        new_inst += 1
                        cache[addr] = {"result": "NEW_INST", "first_ts": creation_ts, "checked": now_ts}
                        new_wallets.append({"address": addr, "balance": total, "age_days": wallet_age, "type": "NEW_INST", "wallet_type": "Contract"})
                        print(f"  🏛️ NEW INST: {addr[:14]}... ({total:,.0f} ZRO, contract {wallet_age}d old, deployer: {deployer[:10]}...)")
                    else:
                        h["label"] = "Fresh Wallet"
                        h["type"] = "FRESH"
                        new_fresh += 1
                        cache[addr] = {"result": "FRESH", "first_ts": creation_ts, "checked": now_ts}
                        new_wallets.append({"address": addr, "balance": total, "age_days": wallet_age, "type": "FRESH", "wallet_type": "Contract"})
                        print(f"  🟢 FRESH: {addr[:14]}... ({total:,.0f} ZRO, contract {wallet_age}d old)")
                elif deployer and deployer in KNOWN_DEPLOYERS:
                    wallet_age = (now - creation_ts) // 86400 if creation_ts else 0
                    skipped_contracts += 1
                    cache[addr] = {"result": "OLD", "checked": now_ts}
                    print(f"  🏛️ OLD INST: {addr[:14]}... ({total:,.0f} ZRO, contract {wallet_age}d old)")
                elif creation_ts:
                    wallet_age = (now - creation_ts) // 86400
                    cache[addr] = {"result": "OLD", "checked": now_ts}
                    print(f"  ⚪ OLD:   {addr[:14]}... ({total:,.0f} ZRO, contract {wallet_age}d old)")
                else:
                    cache[addr] = {"result": "SKIP", "checked": now_ts}
                    print(f"  ❓ SKIP:  {addr[:14]}... ({total:,.0f} ZRO, contract, no creation data)")
            else:
                # For EOAs: check first transaction across ALL chains
                first_ts = get_first_tx_timestamp_multichain(addr)

                if first_ts and first_ts > cutoff:
                    wallet_age = (now - first_ts) // 86400
                    # Check for CEX deposit pattern before labeling
                    time.sleep(0.25)
                    if has_cex_interaction(addr):
                        cache[addr] = {"result": "OLD", "first_ts": first_ts, "checked": now_ts, "reason": "CEX_DEPOSIT"}
                        print(f"  🏦 CEX:   {addr[:14]}... ({total:,.0f} ZRO, EOA {wallet_age}d old, CEX interactions)")
                    else:
                        h["label"] = "Fresh Wallet"
                        h["type"] = "FRESH"
                        new_fresh += 1
                        cache[addr] = {"result": "FRESH", "first_ts": first_ts, "checked": now_ts}
                        new_wallets.append({"address": addr, "balance": total, "age_days": wallet_age, "type": "FRESH", "wallet_type": "EOA"})
                        print(f"  🟢 FRESH: {addr[:14]}... ({total:,.0f} ZRO, EOA {wallet_age}d old, multi-chain)")
                elif first_ts:
                    wallet_age = (now - first_ts) // 86400
                    cache[addr] = {"result": "OLD", "first_ts": first_ts, "checked": now_ts}
                    print(f"  ⚪ OLD:   {addr[:14]}... ({total:,.0f} ZRO, EOA {wallet_age}d old, multi-chain)")
                else:
                    cache[addr] = {"result": "SKIP", "checked": now_ts}
                    print(f"  ❓ SKIP:  {addr[:14]}... ({total:,.0f} ZRO, no TX found)")
        except Exception as e:
            print(f"  ⚠️ ERROR: {addr[:14]}... — {e}")
            time.sleep(2)  # Back off on errors

        # Progress
        if checked % 50 == 0:
            print(f"   ... checked {checked}/{len(candidates)}")

    print()
    print(f"✅ Done!")
    print(f"   Cache hits (skipped): {cache_hits}")
    print(f"   API-checked: {checked - cache_hits}")
    print(f"   New FRESH wallets: {new_fresh}")
    print(f"   New INSTITUTIONAL wallets: {new_inst}")
    print(f"   Old institutional contracts: {skipped_contracts}")

    # Always save cache (even if no fresh wallets found)
    save_cache(cache)
    print(f"💾 Cache saved ({len(cache)} entries)")

    if new_fresh > 0 or new_inst > 0:
        with open(DATA_PATH, "w") as f:
            json.dump(data, f, indent=2)
        print(f"💾 Saved to {DATA_PATH}")

        # Send Discord alerts for new wallets
        if new_wallets:
            send_discord_alerts(new_wallets)
    else:
        print("   No changes needed")


def get_zro_price():
    """Fetch current ZRO price from CoinGecko (best-effort)."""
    try:
        url = "https://api.coingecko.com/api/v3/simple/price?ids=layerzero&vs_currencies=usd"
        data = fetch_json(url)
        if data and "layerzero" in data:
            return data["layerzero"]["usd"]
    except Exception:
        pass
    return None


def send_discord_alerts(wallets):
    """Send rich embed notifications to Discord via webhook."""
    if not DISCORD_WEBHOOK_URL:
        print("⚠️ DISCORD_WEBHOOK_URL not set — skipping Discord alerts")
        return

    price = get_zro_price()
    print(f"📢 Sending {len(wallets)} Discord alert(s)...")

    for w in wallets:
        addr = w["address"]
        short_addr = addr[:6] + "…" + addr[-4:]
        balance = w["balance"]
        usd_val = f" (${balance * price:,.0f})" if price else ""
        is_inst = w["type"] == "NEW_INST"

        # Green for FRESH, Blue for NEW_INST
        color = 0x3B82F6 if is_inst else 0x34D399
        title = "🏛️ New Institutional Wallet" if is_inst else "🟢 New Fresh Wallet Detected"

        etherscan_url = f"https://etherscan.io/address/{addr}"
        debank_url = f"https://debank.com/profile/{addr}"

        embed = {
            "title": title,
            "color": color,
            "fields": [
                {"name": "Address", "value": f"[`{short_addr}`]({etherscan_url})", "inline": True},
                {"name": "Balance", "value": f"**{balance:,.0f} ZRO**{usd_val}", "inline": True},
                {"name": "Age", "value": f"{w['age_days']} days", "inline": True},
                {"name": "Type", "value": w["wallet_type"], "inline": True},
                {"name": "Links", "value": f"[Etherscan]({etherscan_url}) · [DeBank]({debank_url})", "inline": False},
            ],
            "footer": {"text": "ZRO Fresh Wallet Alert"},
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }

        payload = json.dumps({"embeds": [embed]}).encode("utf-8")
        try:
            req = Request(DISCORD_WEBHOOK_URL, data=payload, method="POST")
            req.add_header("Content-Type", "application/json")
            req.add_header("User-Agent", "ZRO-Dashboard/1.0")
            with urlopen(req, timeout=10) as resp:
                if resp.status in (200, 204):
                    print(f"  ✅ Alert sent: {short_addr}")
                else:
                    print(f"  ⚠️ Webhook returned {resp.status}")
        except Exception as e:
            print(f"  ❌ Webhook error: {e}")
        time.sleep(1)  # Rate limit: 1 per second

    # Summary embed
    total_balance = sum(w["balance"] for w in wallets)
    total_usd = f" (${total_balance * price:,.0f})" if price else ""
    fresh_count = sum(1 for w in wallets if w["type"] == "FRESH")
    inst_count = sum(1 for w in wallets if w["type"] == "NEW_INST")

    parts = []
    if fresh_count:
        parts.append(f"**{fresh_count}** fresh")
    if inst_count:
        parts.append(f"**{inst_count}** institutional")

    summary_embed = {
        "title": "📊 Fresh Wallet Scan Complete",
        "description": f"Found {' + '.join(parts)} wallet(s)\nTotal: **{total_balance:,.0f} ZRO**{total_usd}",
        "color": 0xA855F7,
        "footer": {"text": "ZRO Analytics · Daily Scan"},
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

    try:
        payload = json.dumps({"embeds": [summary_embed]}).encode("utf-8")
        req = Request(DISCORD_WEBHOOK_URL, data=payload, method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("User-Agent", "ZRO-Dashboard/1.0")
        with urlopen(req, timeout=10):
            print("  ✅ Summary alert sent")
    except Exception as e:
        print(f"  ❌ Summary webhook error: {e}")


if __name__ == "__main__":
    main()
