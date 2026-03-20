#!/usr/bin/env python3
"""
Auto-detect Fresh Wallets.
For every ZRO holder with >10K balance that has no label yet,
check Etherscan for their first-ever transaction date.
If the wallet is younger than 30 days → label it FRESH permanently.

Already-labeled wallets (CEX, FRESH, UNLOCK, etc.) are NEVER overwritten.
Once FRESH is set, it stays forever.
"""
import json, os, time
from urllib.request import urlopen, Request

API_KEY = os.environ.get("ETHERSCAN_API_KEY", "")
MIN_BALANCE_FOR_CHECK = 10_000  # Only check wallets with >10K ZRO
FRESH_AGE_DAYS = 30  # Wallet younger than this = FRESH

DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(DIR, "zro_data.json")

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

def get_first_tx_timestamp(address):
    """Get the timestamp of the address's first-ever transaction on Ethereum."""
    url = (
        f"https://api.etherscan.io/v2/api?chainid=1"
        f"&module=account&action=txlist"
        f"&address={address}"
        f"&startblock=0&endblock=99999999"
        f"&page=1&offset=1&sort=asc"
        f"&apikey={API_KEY}"
    )
    data = fetch_json(url)
    if not data or data.get("status") != "1" or not data.get("result"):
        # Try internal transactions (some wallets only have contract interactions)
        url2 = (
            f"https://api.etherscan.io/v2/api?chainid=1"
            f"&module=account&action=tokentx"
            f"&address={address}"
            f"&startblock=0&endblock=99999999"
            f"&page=1&offset=1&sort=asc"
            f"&apikey={API_KEY}"
        )
        data = fetch_json(url2)
        if not data or data.get("status") != "1" or not data.get("result"):
            return None
    
    first_tx = data["result"][0]
    return int(first_tx.get("timeStamp", 0))

def main():
    if not API_KEY:
        print("❌ ETHERSCAN_API_KEY not set")
        return

    with open(DATA_PATH) as f:
        data = json.load(f)

    now = int(time.time())
    cutoff = now - (FRESH_AGE_DAYS * 86400)  # 30 days ago
    
    # Get existing FRESH addresses (never re-check these)
    already_fresh = set()
    already_labeled = set()
    for h in data["top_holders"]:
        addr = h["address"].lower()
        if h.get("type") == "FRESH":
            already_fresh.add(addr)
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

    print(f"🔍 Fresh Wallet Detection")
    print(f"   Already FRESH: {len(already_fresh)}")
    print(f"   Already labeled (skip): {len(already_labeled)}")
    print(f"   Candidates to check: {len(candidates)}")
    print(f"   Cutoff date: {time.strftime('%Y-%m-%d', time.gmtime(cutoff))}")
    print()

    if not candidates:
        print("✅ No new candidates to check")
        return

    new_fresh = 0
    checked = 0
    
    for h in candidates:
        addr = h["address"]
        total = sum(h.get("balances", {}).values())
        
        checked += 1
        first_ts = get_first_tx_timestamp(addr)
        
        if first_ts and first_ts > cutoff:
            wallet_age = (now - first_ts) // 86400
            h["label"] = "Fresh Wallet"
            h["type"] = "FRESH"
            new_fresh += 1
            print(f"  🟢 FRESH: {addr[:14]}... ({total:,.0f} ZRO, {wallet_age}d old)")
        elif first_ts:
            wallet_age = (now - first_ts) // 86400
            print(f"  ⚪ OLD:   {addr[:14]}... ({total:,.0f} ZRO, {wallet_age}d old)")
        else:
            print(f"  ❓ SKIP:  {addr[:14]}... ({total:,.0f} ZRO, no tx found)")
        
        # Rate limit: 5 req/s free tier, be safe
        time.sleep(0.3)
        
        # Progress
        if checked % 50 == 0:
            print(f"   ... checked {checked}/{len(candidates)}")

    print()
    print(f"✅ Done! New FRESH wallets found: {new_fresh}")
    print(f"   Total FRESH now: {len(already_fresh) + new_fresh}")

    if new_fresh > 0:
        with open(DATA_PATH, "w") as f:
            json.dump(data, f)
        print(f"💾 Saved to {DATA_PATH}")
    else:
        print("   No changes needed")

if __name__ == "__main__":
    main()
