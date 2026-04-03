#!/usr/bin/env python3
"""
Monitor large ZRO token transfers (≥100K) from any source.
Detects whale accumulation, sends Discord alerts, auto-adds to holders.

Runs every 15 min via GitHub Actions (hourly-monitor.yml).
"""
import json, os, time
from urllib.request import urlopen, Request
from utils import atomic_json_dump, fetch_json, get_api_key

API_KEY = get_api_key()
DISCORD_WEBHOOK_URL = os.environ.get("DISCORD_WEBHOOK_URL", "")
ZRO_CONTRACT = "0x6985884c4392d348587b19cb9eaaf157f13271cd"
COINBASE_PRIME_HUB = "0xcd531ae9efcce479654c4926dec5f6209531ca7b"

DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(DIR, "zro_data.json")
STATE_PATH = os.path.join(DIR, "whale_monitor_state.json")

MIN_WHALE_AMOUNT = 100_000  # Only track transfers ≥ 100K ZRO

# Known CEX hot wallets (same as monitor_cb_prime.py)
KNOWN_CEX = {
    "0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43": "Coinbase",
    "0x503828976d22510aad0201ac7ec88293211d23da": "Coinbase",
    "0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740": "Coinbase",
    "0x3cd751e6b0078be393132286c442345e68ff0afc": "Coinbase",
    "0xb5d85cbf7cb3ee0d56b3bb207d5fc4b82f43f511": "Coinbase",
    "0x28c6c06298d514db089934071355e5743bf21d60": "Binance",
    "0x21a31ee1afc51d94c2efccaa2092ad1028285549": "Binance",
    "0xdfd5293d8e347dfe59e90efd55b2956a1343963d": "Binance",
    "0x56eddb7aa87536c09ccc2793473599fd21a8b17f": "Binance",
    "0x6cc5f688a315f3dc28a7781717a9a798a59fda7b": "OKX",
    "0x236f9f97e0e62388479bf9e5ba4889e46b0273c3": "OKX",
    "0x4a4aaa0155237881fbd5c34bfae16e985a7b068d": "OKX",
    "0xf89d7b9c864f589bbf53a82105107622b35eaa40": "Bybit",
    "0x1db92e2eebc8e0c075a02bea49a2935bcd2dfcf4": "Bybit",
    "0xeb2629a2734e272bcc07bda959863f316f4bd4cf": "Coinbase",
    "0x6e1abc08ad3a845726ac93c0715be2d7c9e7129b": "Coinbase",
    "0x137f79a70fc9c6d5c80f94a5fc44bd95a567652d": "Coinbase",
    "0xaeee6e35eb33a464a82a51dbf52e85da137b6bcc": "Coinbase",
    "0x94e19e5c29a75b1b1bdcf247bb55425ca7d319d4": "Coinbase",
    "0x63be42b40816eb08f6ea480e5875e6f4668da379": "Upbit",
}

# CB Prime investor wallets — skip these (already tracked by monitor_cb_prime.py)
# Will be populated dynamically from zro_data.json


def get_zro_price():
    try:
        data = fetch_json("https://api.coingecko.com/api/v3/simple/price?ids=layerzero&vs_currencies=usd")
        if data and "layerzero" in data:
            return data["layerzero"]["usd"]
    except Exception:
        pass
    return None


def load_state():
    if os.path.exists(STATE_PATH):
        with open(STATE_PATH) as f:
            return json.load(f)
    return {"last_block": 0, "seen_txs": []}


def save_state(state):
    state["seen_txs"] = state["seen_txs"][-2000:]
    atomic_json_dump(state, STATE_PATH)


def send_discord(embed):
    if not DISCORD_WEBHOOK_URL:
        print(f"  ⚠️ No webhook — skipping: {embed.get('title', '')}")
        return
    payload = json.dumps({"embeds": [embed]}).encode("utf-8")
    try:
        req = Request(DISCORD_WEBHOOK_URL, data=payload, method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("User-Agent", "ZRO-Dashboard/1.0")
        with urlopen(req, timeout=10) as resp:
            if resp.status in (200, 204):
                print(f"  ✅ Alert sent: {embed.get('title', '')}")
            else:
                print(f"  ⚠️ Webhook returned {resp.status}")
    except Exception as e:
        print(f"  ❌ Webhook error: {e}")
    time.sleep(1.5)


def fmt(n):
    if abs(n) >= 1e6:
        return f"{n/1e6:,.2f}M"
    if abs(n) >= 1e3:
        return f"{n/1e3:,.1f}K"
    return f"{n:,.0f}"


def fmt_usd(n):
    if n is None:
        return ""
    if abs(n) >= 1e6:
        return f"${n/1e6:,.2f}M"
    if abs(n) >= 1e3:
        return f"${n/1e3:,.1f}K"
    return f"${n:,.0f}"


def short_addr(addr):
    return addr[:6] + "…" + addr[-4:]


def check_wallet_age(address):
    """Check if wallet is fresh (<30 days). Returns (is_fresh, age_days, creation_ts)."""
    # Try internal transactions (contract creation)
    url = (
        f"https://api.etherscan.io/v2/api?chainid=1"
        f"&module=account&action=txlistinternal"
        f"&address={address}"
        f"&startblock=0&endblock=99999999"
        f"&page=1&offset=1&sort=asc"
        f"&apikey={API_KEY}"
    )
    data = fetch_json(url)
    first_ts = 0
    if data and data.get("status") == "1" and data.get("result"):
        first_ts = int(data["result"][0].get("timeStamp", "0"))

    if not first_ts:
        # Try normal transactions
        url2 = (
            f"https://api.etherscan.io/v2/api?chainid=1"
            f"&module=account&action=txlist"
            f"&address={address}"
            f"&startblock=0&endblock=99999999"
            f"&page=1&offset=1&sort=asc"
            f"&apikey={API_KEY}"
        )
        data2 = fetch_json(url2)
        if data2 and data2.get("status") == "1" and data2.get("result"):
            first_ts = int(data2["result"][0].get("timeStamp", "0"))
        time.sleep(0.25)

    if not first_ts:
        return False, 0, 0

    now = int(time.time())
    age_days = (now - first_ts) // 86400
    return age_days <= 30, age_days, first_ts


def main():
    if not API_KEY:
        print("❌ ETHERSCAN_API_KEY not set")
        return

    with open(DATA_PATH) as f:
        data = json.load(f)

    # Build sets for skipping
    cb_prime_addrs = set()
    existing_addrs = {}
    for h in data["top_holders"]:
        addr_low = h["address"].lower()
        existing_addrs[addr_low] = h
        if h.get("label") == "Coinbase Prime Investor":
            cb_prime_addrs.add(addr_low)

    # Build label map
    label_map = {}
    for h in data["top_holders"]:
        if h.get("label"):
            label_map[h["address"].lower()] = h["label"]
    label_map[COINBASE_PRIME_HUB] = "Coinbase Prime Hub"
    for cex_addr, cex_name in KNOWN_CEX.items():
        label_map[cex_addr] = cex_name

    state = load_state()
    seen = set(state.get("seen_txs", []))
    start_block = state.get("last_block", 0)

    # First run — start from last ~7 days
    if start_block == 0:
        url = f"https://api.etherscan.io/v2/api?chainid=1&module=proxy&action=eth_blockNumber&apikey={API_KEY}"
        resp = fetch_json(url)
        if resp and resp.get("result"):
            try:
                latest = int(resp["result"], 16)
            except (ValueError, TypeError):
                print(f"   ⚠️ Could not get block number: {str(resp['result'])[:60]}")
                return
            start_block = latest - 50400  # ~7 days back (12s/block * 7 * 86400)
            print(f"   First run — starting from block {start_block} (~7 days back)")

    price = get_zro_price()
    print(f"🐋 Whale Transfer Monitor (≥{fmt(MIN_WHALE_AMOUNT)} ZRO)")
    print(f"   ZRO price: ${price:.2f}" if price else "   ZRO price: unavailable")

    # Fetch recent ZRO token transfers globally (from contract, not per-wallet)
    url = (
        f"https://api.etherscan.io/v2/api?chainid=1"
        f"&module=account&action=tokentx"
        f"&contractaddress={ZRO_CONTRACT}"
        f"&startblock={start_block}&endblock=99999999"
        f"&page=1&offset=200&sort=desc"
        f"&apikey={API_KEY}"
    )
    resp = fetch_json(url)
    transfers = []
    if resp and resp.get("status") == "1" and resp.get("result"):
        for tx in resp["result"]:
            tx_hash = tx.get("hash", "")
            if tx_hash in seen:
                continue
            value = int(tx.get("value", "0")) / 1e18
            if value < MIN_WHALE_AMOUNT:
                continue
            transfers.append(tx)

    print(f"   Found {len(transfers)} new large transfers (≥{fmt(MIN_WHALE_AMOUNT)} ZRO)")

    # Process transfers
    max_block = start_block
    alerts_sent = 0
    new_holders_added = 0
    whale_transfers = data.get("whale_transfers", [])

    for tx in sorted(transfers, key=lambda x: int(x.get("blockNumber", "0"))):
        tx_hash = tx["hash"]
        from_addr = tx.get("from", "").lower()
        to_addr = tx.get("to", "").lower()
        value = int(tx.get("value", "0")) / 1e18
        block = int(tx.get("blockNumber", "0"))
        timestamp = int(tx.get("timeStamp", "0"))
        max_block = max(max_block, block)

        # Skip CB Prime Hub transfers (already tracked by monitor_cb_prime.py)
        if from_addr == COINBASE_PRIME_HUB or to_addr == COINBASE_PRIME_HUB:
            seen.add(tx_hash)
            continue

        # Skip if BOTH from and to are CB Prime investors (internal rebalancing)
        if from_addr in cb_prime_addrs and to_addr in cb_prime_addrs:
            seen.add(tx_hash)
            continue

        # Classify transfer
        from_is_cex = from_addr in KNOWN_CEX
        to_is_cex = to_addr in KNOWN_CEX
        from_label = label_map.get(from_addr, "")
        to_label = label_map.get(to_addr, "")

        # Skip internal CEX-to-CEX transfers (e.g. Binance 14 → Binance 15)
        if from_is_cex and to_is_cex:
            seen.add(tx_hash)
            print(f"  ⏭️ Skip CEX→CEX: {KNOWN_CEX[from_addr]} → {KNOWN_CEX[to_addr]} ({fmt(value)} ZRO)")
            continue

        if from_is_cex:
            transfer_type = "CEX_WITHDRAWAL"
            direction_emoji = "🟢"
        elif to_is_cex:
            transfer_type = "CEX_DEPOSIT"
            direction_emoji = "🔴"
        else:
            transfer_type = "TRANSFER"
            direction_emoji = "🔄"

        # Check if recipient is a new wallet (fresh check)
        wallet_info = ""
        if not to_is_cex and to_addr not in existing_addrs:
            is_fresh, age_days, creation_ts = check_wallet_age(to_addr)
            time.sleep(0.25)
            if is_fresh:
                wallet_info = f"🆕 Fresh Wallet ({age_days}d old)"
                # Auto-add to holders as fresh wallet
                new_holder = {
                    "address": to_addr,
                    "balances": {"ethereum": value},
                    "label": "Fresh Wallet",
                    "type": "FRESH",
                    "wallet_created": creation_ts,
                    "last_flow": timestamp,
                    "last_flow_amount": value,
                }
                if from_label:
                    new_holder["funded_by"] = from_label
                data["top_holders"].append(new_holder)
                existing_addrs[to_addr] = new_holder
                label_map[to_addr] = "Fresh Wallet"
                new_holders_added += 1
                print(f"  ➕ Auto-added fresh wallet {short_addr(to_addr)} to holders")
            else:
                wallet_info = f"Wallet ({age_days}d old)" if age_days else "Unknown wallet"
                # Auto-add to holders as unlabeled
                new_holder = {
                    "address": to_addr,
                    "balances": {"ethereum": value},
                    "label": "",
                    "type": "",
                    "last_flow": timestamp,
                    "last_flow_amount": value,
                }
                data["top_holders"].append(new_holder)
                existing_addrs[to_addr] = new_holder
                new_holders_added += 1
                print(f"  ➕ Auto-added wallet {short_addr(to_addr)} to holders")
        elif to_addr in existing_addrs:
            h = existing_addrs[to_addr]
            to_label = to_label or h.get("label", "")
            wallet_info = to_label or "Known holder"
            # Update last_flow for existing holder
            h["last_flow"] = timestamp
            h["last_flow_amount"] = value

        # Also update sender's last_flow (outflow = negative)
        if from_addr in existing_addrs and not from_is_cex:
            h = existing_addrs[from_addr]
            h["last_flow"] = timestamp
            h["last_flow_amount"] = -value

        # Store whale transfer
        transfer_record = {
            "tx_hash": tx_hash,
            "from": from_addr,
            "to": to_addr,
            "value": round(value, 2),
            "timestamp": timestamp,
            "type": transfer_type,
            "from_label": from_label or short_addr(from_addr),
            "to_label": to_label or short_addr(to_addr),
        }
        whale_transfers.append(transfer_record)

        usd_val = fmt_usd(value * price) if price else ""
        etherscan_tx = f"https://etherscan.io/tx/{tx_hash}"

        print(f"  {direction_emoji} {transfer_type}: {fmt(value)} ZRO ({usd_val})")
        print(f"     From: {from_label or short_addr(from_addr)} → To: {to_label or short_addr(to_addr)}")

        # Discord alert
        if transfer_type == "CEX_WITHDRAWAL":
            color = 0x4ade80  # green
            title = f"🐋 Whale Withdrawal: +{fmt(value)} ZRO"
            desc = (
                f"**From:** {from_label} (CEX)\n"
                f"**To:** `{to_addr[:14]}…`\n"
                f"**{wallet_info}**" if wallet_info else ""
            )
        elif transfer_type == "CEX_DEPOSIT":
            color = 0xf87171  # red
            title = f"🐋 Whale Deposit: {fmt(value)} ZRO → {KNOWN_CEX.get(to_addr, 'CEX')}"
            desc = (
                f"**From:** `{from_addr[:14]}…` ({from_label or 'Unknown'})\n"
                f"**To:** {KNOWN_CEX.get(to_addr, 'CEX')}"
            )
        else:
            color = 0x60a5fa  # blue
            title = f"🐋 Whale Transfer: {fmt(value)} ZRO"
            desc = (
                f"**From:** `{from_addr[:14]}…` ({from_label or 'Unknown'})\n"
                f"**To:** `{to_addr[:14]}…`\n"
                f"**{wallet_info}**" if wallet_info else ""
            )

        embed = {
            "title": title,
            "description": desc,
            "color": color,
            "fields": [
                {"name": "💰 Value", "value": f"{fmt(value)} ZRO" + (f" ({usd_val})" if usd_val else ""), "inline": True},
                {"name": "📊 Type", "value": transfer_type.replace("_", " ").title(), "inline": True},
            ],
            "url": etherscan_tx,
            "footer": {"text": f"TX: {tx_hash[:16]}… • Block #{block}"},
        }
        send_discord(embed)
        alerts_sent += 1
        seen.add(tx_hash)

    # Keep only last 500 whale transfers
    whale_transfers = whale_transfers[-500:]
    data["whale_transfers"] = whale_transfers

    # Final dedup + cleanup (this is last script in pipeline)
    holders = data["top_holders"]
    holders.sort(key=lambda x: sum(x.get("balances", {}).values()), reverse=True)
    seen_addrs = set()
    deduped = []
    for h in holders:
        a = h["address"].lower()
        if a not in seen_addrs:
            seen_addrs.add(a)
            deduped.append(h)
    dup_rm = len(holders) - len(deduped)
    deduped = [h for h in deduped if sum(h.get("balances", {}).values()) > 0]
    zero_rm = len(holders) - dup_rm - len(deduped)
    if dup_rm: print(f"   🔄 Removed {dup_rm} duplicate holders")
    if zero_rm: print(f"   🧹 Removed {zero_rm} zero-balance holders")
    data["top_holders"] = deduped

    # Save data
    atomic_json_dump(data, DATA_PATH)

    # Save state
    state["last_block"] = max_block
    state["seen_txs"] = list(seen)
    save_state(state)

    print(f"\n✅ Done: {alerts_sent} alerts sent, {new_holders_added} holders added")
    print(f"   Total whale transfers stored: {len(whale_transfers)}")


if __name__ == "__main__":
    main()
