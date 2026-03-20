#!/usr/bin/env python3
"""
Whale Alert — notify when new large ZRO holders appear.

Compares current zro_data.json with previous snapshot.
Alerts on:
  - New wallets with >100K ZRO
  - Existing wallets gaining >500K ZRO
  - New FRESH or NEW_INST wallets

Sends alerts via Discord webhook (optional) and prints to stdout.
"""
import json, os, time
from urllib.request import urlopen, Request

DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(DIR, "zro_data.json")
SNAPSHOT_PATH = os.path.join(DIR, "whale_snapshot.json")

DISCORD_WEBHOOK = os.environ.get("DISCORD_WEBHOOK_URL", "")
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")

# Alert thresholds
NEW_WHALE_MIN = 100_000      # Alert on new wallets with >100K ZRO
BALANCE_CHANGE_MIN = 500_000  # Alert on balance changes >500K ZRO


def load_json(path):
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return {}


def save_json(path, data):
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def send_discord(message):
    """Send alert to Discord via webhook."""
    if not DISCORD_WEBHOOK:
        return
    payload = json.dumps({"content": message}).encode()
    try:
        req = Request(DISCORD_WEBHOOK, data=payload, headers={
            "Content-Type": "application/json",
            "User-Agent": "ZRO-Dashboard/1.0"
        })
        urlopen(req, timeout=10)
        print(f"   📨 Discord alert sent")
    except Exception as e:
        print(f"   ⚠️ Discord send failed: {e}")


def send_telegram(message):
    """Send alert to Telegram."""
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = json.dumps({
        "chat_id": TELEGRAM_CHAT_ID,
        "text": message,
        "parse_mode": "Markdown"
    }).encode()
    try:
        req = Request(url, data=payload, headers={
            "Content-Type": "application/json",
            "User-Agent": "ZRO-Dashboard/1.0"
        })
        urlopen(req, timeout=10)
        print(f"   📨 Telegram alert sent")
    except Exception as e:
        print(f"   ⚠️ Telegram send failed: {e}")


def send_alert(message):
    """Send alert to all configured channels."""
    print(f"\n🚨 {message}")
    send_discord(f"🚨 **ZRO Alert**\n{message}")
    send_telegram(f"🚨 *ZRO Alert*\n{message}")


def main():
    data = load_json(DATA_PATH)
    snapshot = load_json(SNAPSHOT_PATH)

    if not data.get("top_holders"):
        print("❌ No holder data found")
        return

    # Build current state
    current = {}
    for h in data["top_holders"]:
        addr = h["address"].lower()
        total = sum(h.get("balances", {}).values())
        current[addr] = {
            "balance": total,
            "label": h.get("label", ""),
            "type": h.get("type", ""),
        }

    # Build previous state
    previous = snapshot.get("holders", {})

    alerts = []
    print(f"🔍 Whale Alert Scanner")
    print(f"   Current holders: {len(current)}")
    print(f"   Previous snapshot: {len(previous)} holders")

    # Check for new whales
    for addr, info in current.items():
        bal = info["balance"]
        label = info["label"]
        htype = info["type"]
        prev = previous.get(addr, {})
        prev_bal = prev.get("balance", 0)

        short = f"{addr[:8]}…{addr[-4:]}"
        link = f"https://debank.com/profile/{addr}"

        # New wallet with significant balance
        if addr not in previous and bal >= NEW_WHALE_MIN:
            tag = f" [{label}]" if label else ""
            alerts.append(f"🆕 New whale: `{short}`{tag} — **{bal:,.0f} ZRO** ({link})")

        # New FRESH wallet
        elif addr not in previous and htype == "FRESH":
            alerts.append(f"🟢 Fresh wallet: `{short}` — **{bal:,.0f} ZRO** ({link})")

        # New institutional wallet
        elif addr not in previous and htype == "NEW_INST":
            alerts.append(f"🏛️ New institutional: `{short}` — **{bal:,.0f} ZRO** ({link})")

        # Large balance increase
        elif prev_bal > 0 and (bal - prev_bal) >= BALANCE_CHANGE_MIN:
            diff = bal - prev_bal
            tag = f" [{label}]" if label else ""
            alerts.append(f"📈 Accumulation: `{short}`{tag} +**{diff:,.0f} ZRO** (now {bal:,.0f}) ({link})")

        # Large balance decrease
        elif prev_bal > 0 and (prev_bal - bal) >= BALANCE_CHANGE_MIN:
            diff = prev_bal - bal
            tag = f" [{label}]" if label else ""
            alerts.append(f"📉 Outflow: `{short}`{tag} -**{diff:,.0f} ZRO** (now {bal:,.0f}) ({link})")

    # Send alerts
    if alerts:
        print(f"\n🚨 {len(alerts)} alerts:")
        for alert in alerts:
            send_alert(alert)
    else:
        print(f"\n✅ No whale alerts")

    # Save snapshot for next run
    save_json(SNAPSHOT_PATH, {
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "holders": current
    })
    print(f"\n💾 Snapshot saved ({len(current)} holders)")


if __name__ == "__main__":
    main()
