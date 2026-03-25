#!/usr/bin/env python3
"""
Auto-Label Discovery Script for ZRO Dashboard.
Checks top unlabeled wallets in flows against Etherscan heuristics
and auto-classifies them (CEX, MultiSig, Protocol, Whale, etc.)
Sends Discord alerts for each new label discovered.

Runs daily via CI (update-data.yml). Max 10 wallets per run.
"""
import json, os, time, datetime
from urllib.request import Request, urlopen
from utils import fetch_json, get_api_key, atomic_json_dump

DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(DIR, "zro_data.json")
CACHE_PATH = os.path.join(DIR, "label_cache.json")
API_KEY = get_api_key()
DISCORD_WEBHOOK_URL = os.environ.get("DISCORD_WEBHOOK_URL", "")
ZRO_CONTRACT = "0x6985884c4392d348587b19cb9eaaf157f13271cd"

MAX_WALLETS_PER_RUN = 10

# Known CEX funder patterns (lowercase) — match partial label from Etherscan
KNOWN_CEX_FUNDERS = {
    "binance": "Binance",
    "coinbase": "Coinbase",
    "kraken": "Kraken",
    "okx": "OKX",
    "okex": "OKX",
    "bybit": "ByBit",
    "kucoin": "KuCoin",
    "gate.io": "Gate.io",
    "htx": "HTX",
    "huobi": "HTX",
    "bitfinex": "Bitfinex",
    "crypto.com": "Crypto.com",
    "gemini": "Gemini",
    "mexc": "MEXC",
    "upbit": "Upbit",
    "bitget": "Bitget",
}

# Known CEX hot wallet addresses (lowercase)
KNOWN_CEX_ADDRESSES = {
    "0x28c6c06298d514db089934071355e5743bf21d60": "Binance",
    "0x21a31ee1afc51d94c2efccaa2092ad1028285549": "Binance",
    "0xdfd5293d8e347dfe59e90efd55b2956a1343963d": "Binance",
    "0x56eddb7aa87536c09ccc2793473599fd21a8b17f": "Binance",
    "0xf977814e90da44bfa03b6295a0616a897441acec": "Binance",
    "0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43": "Coinbase",
    "0x503828976d22510aad0201ac7ec88293211d23da": "Coinbase",
    "0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740": "Coinbase",
    "0x3cd751e6b0078be393132286c442345e68ff0afc": "Coinbase",
    "0xb5d85cbf7cb3ee0d56b3bb207d5fc4b82f43f511": "Coinbase",
    "0xeb2629a2734e272bcc07bda959863f316f4bd4cf": "Coinbase",
    "0xcd531ae9efcce479654c4926dec5f6209531ca7b": "Coinbase Prime",
    "0x6cc5f688a315f3dc28a7781717a9a798a59fda7b": "OKX",
    "0x98ec059dc3adfbdd63429227115d9f17bebe7455": "OKX",
    "0x6cC5F688a315f3dC28A7781717a9A798a59fDA7b": "OKX",
    "0x75e89d5979e4f6fba9f97c104c2f0afb3f1dcb88": "MEXC",
    "0xf89d7b9c864f589bbf53a82105107622b35eaa40": "ByBit",
    "0x1ab4973a48dc892cd9971ece8e01dcc7688f8f23": "ByBit",
    "0xd9d93951896b4ef97d251334ef2a0e39f6f6d7d7": "ByBit",
    "0x2faf487a4414fe77e2327f0bf4ae2a264a776ad2": "Gemini",
    "0x0d0707963952f2fba59dd06f2b425ace40b492fe": "Gate.io",
    "0xd793281b45cebbdc1e30e3e3e47d7c5e7713e23d": "HTX",
    "0x46340b20830761efd32832a74d7169b29feb9758": "HTX",
    "0xb8e6d31e7b212b2b7250ee9c26c56cebbfbe6b23": "KuCoin",
}


def load_cache():
    """Load label discovery cache."""
    if os.path.exists(CACHE_PATH):
        with open(CACHE_PATH) as f:
            return json.load(f)
    return {}


def save_cache(cache):
    """Save label discovery cache."""
    atomic_json_dump(cache, CACHE_PATH, indent=None)


def is_contract(address):
    """Check if address is a smart contract."""
    url = (
        f"https://api.etherscan.io/v2/api?chainid=1"
        f"&module=proxy&action=eth_getCode"
        f"&address={address}"
        f"&apikey={API_KEY}"
    )
    resp = fetch_json(url)
    if not resp:
        return False
    code = resp.get("result", "0x")
    return code and code != "0x" and len(code) > 4


def get_first_funder(address):
    """Get the funder of the first ETH transaction."""
    url = (
        f"https://api.etherscan.io/v2/api?chainid=1"
        f"&module=account&action=txlist"
        f"&address={address}"
        f"&startblock=0&endblock=99999999"
        f"&page=1&offset=5&sort=asc"
        f"&apikey={API_KEY}"
    )
    resp = fetch_json(url)
    if not resp or resp.get("status") != "1" or not resp.get("result"):
        return None, None
    for tx in resp["result"]:
        if tx.get("to", "").lower() == address.lower():
            funder = tx["from"].lower()
            return funder, tx.get("functionName", "")
    return None, None


def get_tx_count(address):
    """Get normal transaction count."""
    url = (
        f"https://api.etherscan.io/v2/api?chainid=1"
        f"&module=proxy&action=eth_getTransactionCount"
        f"&address={address}&tag=latest"
        f"&apikey={API_KEY}"
    )
    resp = fetch_json(url)
    if not resp or "result" not in resp:
        return 0
    try:
        return int(resp["result"], 16)
    except (ValueError, TypeError):
        return 0


def get_zro_transfer_stats(address):
    """Analyze ZRO token transfer patterns."""
    url = (
        f"https://api.etherscan.io/v2/api?chainid=1"
        f"&module=account&action=tokentx"
        f"&address={address}"
        f"&contractaddress={ZRO_CONTRACT}"
        f"&startblock=0&endblock=99999999"
        f"&page=1&offset=200&sort=desc"
        f"&apikey={API_KEY}"
    )
    resp = fetch_json(url)
    if not resp or resp.get("status") != "1" or not resp.get("result"):
        return {"total": 0, "out": 0, "in": 0, "cex_out": 0, "cex_out_pct": 0}

    txs = resp["result"]
    total_out = 0
    total_in = 0
    cex_out_count = 0
    cex_out_value = 0
    total_out_value = 0

    for tx in txs:
        from_addr = tx.get("from", "").lower()
        to_addr = tx.get("to", "").lower()
        value = int(tx.get("value", "0")) / 1e18

        if from_addr == address.lower():
            total_out += 1
            total_out_value += value
            if to_addr in KNOWN_CEX_ADDRESSES:
                cex_out_count += 1
                cex_out_value += value
        elif to_addr == address.lower():
            total_in += 1

    cex_pct = (cex_out_value / total_out_value * 100) if total_out_value > 0 else 0

    return {
        "total": len(txs),
        "out": total_out,
        "in": total_in,
        "cex_out": cex_out_count,
        "cex_out_pct": round(cex_pct, 1),
    }


def check_funder_label(funder_addr):
    """Check if funder address has a known CEX label on Etherscan or in our list."""
    # Check known addresses first
    if funder_addr in KNOWN_CEX_ADDRESSES:
        return KNOWN_CEX_ADDRESSES[funder_addr]

    # Check funder's funder (one level up) for CEX labels
    url = (
        f"https://api.etherscan.io/v2/api?chainid=1"
        f"&module=account&action=txlist"
        f"&address={funder_addr}"
        f"&startblock=0&endblock=99999999"
        f"&page=1&offset=3&sort=asc"
        f"&apikey={API_KEY}"
    )
    resp = fetch_json(url)
    if not resp or resp.get("status") != "1" or not resp.get("result"):
        return None

    # Check if the funder's first tx source is a known CEX
    for tx in resp["result"]:
        if tx.get("to", "").lower() == funder_addr:
            grandparent = tx["from"].lower()
            if grandparent in KNOWN_CEX_ADDRESSES:
                return KNOWN_CEX_ADDRESSES[grandparent]
    return None


def classify_wallet(address, balance):
    """
    Classify a wallet using Etherscan heuristics.
    Returns (label, type) or (None, None) if undetermined.
    """
    addr = address.lower()

    # 1. Contract check
    time.sleep(0.22)
    contract = is_contract(addr)

    if contract:
        return "MultiSig/Contract", "MULTISIG"

    # 2. Check funder
    time.sleep(0.22)
    funder, func = get_first_funder(addr)

    if funder:
        # Check directly known CEX
        if funder in KNOWN_CEX_ADDRESSES:
            cex_name = KNOWN_CEX_ADDRESSES[funder]
            # If funder is a CEX, check if THIS wallet behaves like a CEX too
            time.sleep(0.22)
            tx_count = get_tx_count(addr)
            if tx_count > 1000:
                return f"{cex_name} Hot Wallet", "CEX"
            # Otherwise it's funded by CEX = probably a user
            # Don't label — many wallets are funded by CEX but unrelated
            pass

        # Check one level up
        time.sleep(0.22)
        grandparent_cex = check_funder_label(funder)
        if grandparent_cex:
            time.sleep(0.22)
            tx_count = get_tx_count(addr)
            if tx_count > 1000:
                return f"{grandparent_cex} Hot Wallet", "CEX"

    # 3. Transaction count
    time.sleep(0.22)
    tx_count = get_tx_count(addr)

    if tx_count > 5000:
        return "Exchange/Bot", "CEX"

    # 4. ZRO transfer patterns
    time.sleep(0.22)
    zro_stats = get_zro_transfer_stats(addr)

    # Sends >50% of ZRO to known CEX = CEX deposit wallet
    if zro_stats["cex_out"] >= 3 and zro_stats["cex_out_pct"] > 50:
        return "CEX Deposit Wallet", "CEX"

    # High-volume ZRO trader (>100 ZRO transfers)
    if zro_stats["total"] >= 100 and zro_stats["out"] >= 30:
        return "Active Trader", "WHALE"

    # Low activity, large balance = whale
    if balance >= 1_000_000 and tx_count < 50 and zro_stats["total"] < 30:
        return "Whale", "WHALE"

    # Can't determine
    return None, None


def send_discord_alert(discoveries):
    """Send Discord alert with newly labeled wallets."""
    if not DISCORD_WEBHOOK_URL or not discoveries:
        return

    lines = []
    for d in discoveries:
        etherscan = f"https://etherscan.io/address/{d['address']}"
        lines.append(
            f"• [{d['address'][:10]}...{d['address'][-4:]}]({etherscan}) "
            f"→ **{d['label']}** ({d['type']}) — {d['balance']:,.0f} ZRO"
        )

    embed = {
        "title": f"🏷️ Auto-Label: {len(discoveries)} new labels",
        "description": "\n".join(lines),
        "color": 0x7289DA,
        "footer": {"text": f"Auto-Label Discovery • {datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M')} UTC"},
    }

    payload = json.dumps({"embeds": [embed]}).encode()
    try:
        req = Request(DISCORD_WEBHOOK_URL, data=payload, method="POST")
        req.add_header("Content-Type", "application/json")
        urlopen(req, timeout=10)
        print(f"📤 Discord alert sent ({len(discoveries)} labels)")
    except Exception as e:
        print(f"⚠️ Discord alert failed: {e}")


def main():
    print("🏷️ Auto-Label Discovery")
    print("=" * 50)

    with open(DATA_PATH) as f:
        data = json.load(f)

    cache = load_cache()

    # Build set of already-labeled addresses
    labeled = set()
    for h in data["top_holders"]:
        if h.get("label"):
            labeled.add(h["address"].lower())

    # Get unlabeled wallets from flows, sorted by ZRO volume
    flow_wallets = {}
    for period, period_data in data.get("flows", {}).items():
        for flow_type in ["accumulators", "sellers"]:
            for f in period_data.get(flow_type, []):
                addr = f["address"].lower()
                vol = abs(f.get("net_flow", 0))
                if addr not in labeled and addr not in flow_wallets:
                    flow_wallets[addr] = vol
                elif addr in flow_wallets:
                    flow_wallets[addr] = max(flow_wallets[addr], vol)

    # Also add top unlabeled holders by balance
    for h in data["top_holders"]:
        addr = h["address"].lower()
        if addr not in labeled:
            bal = sum(h.get("balances", {}).values())
            if addr not in flow_wallets or bal > flow_wallets[addr]:
                flow_wallets[addr] = bal

    # Sort by volume/balance descending
    candidates = sorted(flow_wallets.items(), key=lambda x: x[1], reverse=True)

    # Filter out already-checked wallets (from cache)
    unchecked = [(addr, vol) for addr, vol in candidates if addr not in cache]

    print(f"  Total candidates: {len(candidates)}")
    print(f"  Already checked: {len(candidates) - len(unchecked)}")
    print(f"  To check this run: {min(MAX_WALLETS_PER_RUN, len(unchecked))}")
    print()

    discoveries = []
    checked_count = 0

    for addr, vol in unchecked[:MAX_WALLETS_PER_RUN]:
        checked_count += 1
        # Find holder entry
        holder = next((h for h in data["top_holders"] if h["address"].lower() == addr), None)
        balance = sum(holder.get("balances", {}).values()) if holder else 0

        print(f"  [{checked_count}/{min(MAX_WALLETS_PER_RUN, len(unchecked))}] {addr[:14]}... ({balance:,.0f} ZRO)")

        label, wallet_type = classify_wallet(addr, balance)

        # Cache result (even if None — so we don't re-check)
        cache[addr] = {
            "checked_at": int(time.time()),
            "label": label,
            "type": wallet_type,
        }

        if label and holder:
            holder["label"] = label
            holder["type"] = wallet_type
            discoveries.append({
                "address": addr,
                "label": label,
                "type": wallet_type,
                "balance": balance,
            })
            print(f"       ✅ → {label} ({wallet_type})")
        elif label and not holder:
            print(f"       ℹ️ → {label} (not in holders, skipped)")
        else:
            print(f"       ⬜ Undetermined (cached, won't re-check)")

    print()
    print(f"🏷️ Results: {len(discoveries)} new labels from {checked_count} checked")

    # Save data + cache
    if discoveries:
        atomic_json_dump(data, DATA_PATH)
        print(f"💾 Saved {len(discoveries)} new labels to zro_data.json")

    save_cache(cache)
    print(f"💾 Cache: {len(cache)} total checked wallets")

    # Discord alert
    if discoveries:
        send_discord_alert(discoveries)


if __name__ == "__main__":
    main()
