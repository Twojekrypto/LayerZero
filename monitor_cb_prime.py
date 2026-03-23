#!/usr/bin/env python3
"""
Monitor Coinbase Prime wallet ZRO transfers and send Discord alerts.
Classifies transfers as BUY (incoming), SELL (to CEX), or TRANSFER (internal).

Runs hourly via GitHub Actions alongside refresh_balances.py.
"""
import json, os, time
from urllib.request import urlopen, Request

API_KEY = os.environ.get("ETHERSCAN_API_KEY", "")
DISCORD_WEBHOOK_URL = os.environ.get("DISCORD_CB_WEBHOOK_URL", "")
ZRO_CONTRACT = "0x6985884c4392d348587b19cb9eaaf157f13271cd"
COINBASE_PRIME_HUB = "0xcd531ae9efcce479654c4926dec5f6209531ca7b"

DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(DIR, "zro_data.json")
STATE_PATH = os.path.join(DIR, "cb_monitor_state.json")

# Known CEX hot wallets
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
    "0xf89d7b9c864f589bbf53a82105107622b35eaa40": "Bybit",
    "0x1db92e2eebc8e0c075a02bea49a2935bcd2dfcf4": "Bybit",
    "0xeb2629a2734e272bcc07bda959863f316f4bd4cf": "Coinbase",
}

MIN_ALERT_AMOUNT = 50_000  # Only alert for transfers >= 50K ZRO


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
    # Keep only last 500 TX hashes to avoid unbounded growth
    state["seen_txs"] = state["seen_txs"][-500:]
    with open(STATE_PATH, "w") as f:
        json.dump(state, f, indent=2)


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
    time.sleep(1.5)  # Rate limit


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


def main():
    if not API_KEY:
        print("❌ ETHERSCAN_API_KEY not set")
        return

    # Load CB Prime wallet addresses
    with open(DATA_PATH) as f:
        data = json.load(f)

    cb_addrs = set()
    cb_balances = {}
    for h in data["top_holders"]:
        if h.get("label") == "Coinbase Prime Investor":
            addr = h["address"].lower()
            cb_addrs.add(addr)
            cb_balances[addr] = sum(h.get("balances", {}).values())

    # NOTE: Hub (0xcd531a...) is NOT monitored — it's a distribution point.
    # Only labeled Coinbase Prime Investor wallets trigger alerts.

    print(f"🏦 Coinbase Prime Transfer Monitor")
    print(f"   Monitoring {len(cb_addrs)} wallets")

    state = load_state()
    seen = set(state.get("seen_txs", []))
    start_block = state.get("last_block", 0)

    # If first run, start from recent blocks only (last ~2 hours ≈ 600 blocks)
    if start_block == 0:
        # Get latest block number
        url = f"https://api.etherscan.io/v2/api?chainid=1&module=proxy&action=eth_blockNumber&apikey={API_KEY}"
        resp = fetch_json(url)
        if resp and resp.get("result"):
            latest = int(resp["result"], 16)
            start_block = latest - 600  # ~2 hours back
            print(f"   First run — starting from block {start_block}")

    # Fetch ZRO token transfers for each CB Prime wallet (recent only)
    price = get_zro_price()
    print(f"   ZRO price: ${price:.2f}" if price else "   ZRO price: unavailable")

    all_transfers = []
    checked = 0
    for addr in cb_addrs:
        url = (
            f"https://api.etherscan.io/v2/api?chainid=1"
            f"&module=account&action=tokentx"
            f"&address={addr}"
            f"&contractaddress={ZRO_CONTRACT}"
            f"&startblock={start_block}&endblock=99999999"
            f"&page=1&offset=50&sort=desc"
            f"&apikey={API_KEY}"
        )
        resp = fetch_json(url)
        if resp and resp.get("status") == "1" and resp.get("result"):
            for tx in resp["result"]:
                tx_hash = tx.get("hash", "")
                if tx_hash in seen:
                    continue
                value = int(tx.get("value", "0")) / 1e18
                if value < MIN_ALERT_AMOUNT:
                    continue
                all_transfers.append(tx)
        checked += 1
        time.sleep(0.25)

    print(f"   Checked {checked} wallets, found {len(all_transfers)} new transfers")

    # Deduplicate by TX hash (same TX might appear for sender and receiver)
    unique_txs = {}
    for tx in all_transfers:
        h = tx["hash"]
        if h not in unique_txs:
            unique_txs[h] = tx

    # Process and classify
    alerts_sent = 0
    max_block = start_block
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    for tx_hash, tx in sorted(unique_txs.items(), key=lambda x: int(x[1].get("blockNumber", "0"))):
        from_addr = tx.get("from", "").lower()
        to_addr = tx.get("to", "").lower()
        value = int(tx.get("value", "0")) / 1e18
        block = int(tx.get("blockNumber", "0"))
        max_block = max(max_block, block)

        usd_val = fmt_usd(value * price) if price else ""
        etherscan_tx = f"https://etherscan.io/tx/{tx_hash}"

        from_is_cb = from_addr in cb_addrs
        to_is_cb = to_addr in cb_addrs
        to_is_cex = to_addr in KNOWN_CEX
        from_is_cex = from_addr in KNOWN_CEX

        # Classify
        if from_is_cb and to_is_cb:
            # Internal transfer between CB Prime wallets
            alert_type = "TRANSFER"
            color = 0x0052FF
            title = "🔄 Coinbase Prime — TRANSFER"
            desc = "ZRO moved **between Coinbase Prime wallets**"
            footer = "ZRO Coinbase Prime Alert • Internal Rebalance"
            fields = [
                {"name": "From", "value": f"[`{short_addr(from_addr)}`](https://etherscan.io/address/{from_addr})\nCB Prime", "inline": True},
                {"name": "Amount", "value": f"**{fmt(value)} ZRO**\n({usd_val})" if usd_val else f"**{fmt(value)} ZRO**", "inline": True},
                {"name": "To", "value": f"[`{short_addr(to_addr)}`](https://etherscan.io/address/{to_addr})\nCB Prime", "inline": True},
            ]
        elif from_is_cb and to_is_cex:
            # Sell — CB Prime sends to CEX
            cex_name = KNOWN_CEX.get(to_addr, "Exchange")
            alert_type = "SELL"
            color = 0xFF4444
            title = "🔴 Coinbase Prime — SELL"
            desc = f"CB Prime wallet **sent ZRO to {cex_name}**"
            footer = "ZRO Coinbase Prime Alert • ⚠️ Potential Sell Pressure"
            new_bal = cb_balances.get(from_addr, 0) - value
            bal_usd = fmt_usd(new_bal * price) if price else ""
            fields = [
                {"name": "Wallet", "value": f"[`{short_addr(from_addr)}`](https://etherscan.io/address/{from_addr})", "inline": True},
                {"name": "Amount", "value": f"**-{fmt(value)} ZRO**\n({usd_val})" if usd_val else f"**-{fmt(value)} ZRO**", "inline": True},
                {"name": "Est. Balance", "value": f"{fmt(new_bal)} ZRO\n({bal_usd})" if bal_usd else f"{fmt(new_bal)} ZRO", "inline": True},
                {"name": "Destination", "value": f"🏦 [`{cex_name}`](https://etherscan.io/address/{to_addr})", "inline": True},
            ]
        elif from_is_cb and not to_is_cb:
            # Outgoing to unknown — could be OTC or other
            alert_type = "TRANSFER"
            color = 0xFFA500
            title = "🟠 Coinbase Prime — OUTFLOW"
            desc = "CB Prime wallet **sent ZRO to external address**"
            footer = "ZRO Coinbase Prime Alert • External Transfer"
            fields = [
                {"name": "From", "value": f"[`{short_addr(from_addr)}`](https://etherscan.io/address/{from_addr})\nCB Prime", "inline": True},
                {"name": "Amount", "value": f"**-{fmt(value)} ZRO**\n({usd_val})" if usd_val else f"**-{fmt(value)} ZRO**", "inline": True},
                {"name": "To", "value": f"[`{short_addr(to_addr)}`](https://etherscan.io/address/{to_addr})", "inline": True},
            ]
        elif to_is_cb and (from_is_cex or from_addr == COINBASE_PRIME_HUB):
            # Buy — CB Prime receives from CEX or hub
            source_name = KNOWN_CEX.get(from_addr, "Coinbase Prime 1" if from_addr == COINBASE_PRIME_HUB else "Unknown")
            alert_type = "BUY"
            color = 0x00D395
            title = "🟢 Coinbase Prime — BUY"
            desc = f"CB Prime wallet **received ZRO** from {source_name}"
            footer = "ZRO Coinbase Prime Alert • Institutional Flow Monitor"
            new_bal = cb_balances.get(to_addr, 0) + value
            bal_usd = fmt_usd(new_bal * price) if price else ""
            fields = [
                {"name": "Wallet", "value": f"[`{short_addr(to_addr)}`](https://etherscan.io/address/{to_addr})", "inline": True},
                {"name": "Amount", "value": f"**+{fmt(value)} ZRO**\n({usd_val})" if usd_val else f"**+{fmt(value)} ZRO**", "inline": True},
                {"name": "New Balance", "value": f"{fmt(new_bal)} ZRO\n({bal_usd})" if bal_usd else f"{fmt(new_bal)} ZRO", "inline": True},
                {"name": "Source", "value": f"[`{source_name}`](https://etherscan.io/address/{from_addr})", "inline": True},
            ]
        elif to_is_cb:
            # Inflow from unknown
            alert_type = "BUY"
            color = 0x00D395
            title = "🟢 Coinbase Prime — INFLOW"
            desc = "CB Prime wallet **received ZRO**"
            footer = "ZRO Coinbase Prime Alert • Institutional Flow Monitor"
            fields = [
                {"name": "Wallet", "value": f"[`{short_addr(to_addr)}`](https://etherscan.io/address/{to_addr})", "inline": True},
                {"name": "Amount", "value": f"**+{fmt(value)} ZRO**\n({usd_val})" if usd_val else f"**+{fmt(value)} ZRO**", "inline": True},
                {"name": "From", "value": f"[`{short_addr(from_addr)}`](https://etherscan.io/address/{from_addr})", "inline": True},
            ]
        else:
            continue  # Not relevant

        # Add TX link
        fields.append({"name": "TX", "value": f"[`View on Etherscan`]({etherscan_tx})", "inline": True})

        embed = {
            "title": title,
            "description": desc,
            "color": color,
            "fields": fields,
            "thumbnail": {"url": "https://assets.coingecko.com/coins/images/28206/small/ftxG9_TJ_400x400.jpeg"},
            "footer": {"text": footer},
            "timestamp": now,
        }

        send_discord(embed)
        alerts_sent += 1
        seen.add(tx_hash)

    # Save state
    state["last_block"] = max_block if max_block > 0 else start_block
    state["seen_txs"] = list(seen)
    save_state(state)

    print(f"\n✅ Done! Alerts sent: {alerts_sent}")
    print(f"   State saved (last_block: {state['last_block']})")


if __name__ == "__main__":
    main()
