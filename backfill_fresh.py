#!/usr/bin/env python3
"""
One-time backfill: populate wallet_created + last_flow for existing
Fresh Wallets and clean zero-balance holders.
Run locally or in CI, then delete this script.
"""
import json, os, time
from utils import atomic_json_dump, fetch_json, get_api_key

API_KEY = get_api_key()
ZRO_CONTRACT = "0x6985884c4392d348587b19cb9eaaf157f13271cd"
DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(DIR, "zro_data.json")
CACHE_PATH = os.path.join(DIR, "fresh_cache.json")

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
    "0xcd531ae9efcce479654c4926dec5f6209531ca7b": "Coinbase Prime Hub",
    "0x63be42b40816eb08f6ea480e5875e6f4668da379": "Upbit",
}


def get_first_tx(address):
    """Get wallet creation timestamp from first transaction."""
    # Try internal txs first (contract creation)
    url = (
        f"https://api.etherscan.io/v2/api?chainid=1"
        f"&module=account&action=txlistinternal"
        f"&address={address}&startblock=0&endblock=99999999"
        f"&page=1&offset=1&sort=asc&apikey={API_KEY}"
    )
    data = fetch_json(url)
    if data and data.get("status") == "1" and data.get("result"):
        return int(data["result"][0].get("timeStamp", "0"))

    time.sleep(0.25)
    # Try normal txs
    url2 = (
        f"https://api.etherscan.io/v2/api?chainid=1"
        f"&module=account&action=txlist"
        f"&address={address}&startblock=0&endblock=99999999"
        f"&page=1&offset=1&sort=asc&apikey={API_KEY}"
    )
    data2 = fetch_json(url2)
    if data2 and data2.get("status") == "1" and data2.get("result"):
        return int(data2["result"][0].get("timeStamp", "0"))
    return 0


def get_last_zro_transfer(address):
    """Get last ZRO transfer (in or out) for a wallet."""
    url = (
        f"https://api.etherscan.io/v2/api?chainid=1"
        f"&module=account&action=tokentx"
        f"&address={address}&contractaddress={ZRO_CONTRACT}"
        f"&page=1&offset=5&sort=desc&apikey={API_KEY}"
    )
    data = fetch_json(url)
    if not data or data.get("status") != "1" or not data.get("result"):
        return 0, 0

    for tx in data["result"]:
        value = int(tx.get("value", "0")) / 1e18
        if value < 1:
            continue
        ts = int(tx.get("timeStamp", "0"))
        from_addr = tx.get("from", "").lower()
        to_addr = tx.get("to", "").lower()
        if to_addr == address.lower():
            return ts, value   # inflow = positive
        else:
            return ts, -value  # outflow = negative
    return 0, 0


def main():
    if not API_KEY:
        print("❌ Set ETHERSCAN_API_KEY")
        return

    with open(DATA_PATH) as f:
        data = json.load(f)

    # Load fresh cache to update first_ts
    cache = {}
    if os.path.exists(CACHE_PATH):
        with open(CACHE_PATH) as f:
            cache = json.load(f)

    # --- 1. Backfill wallet_created + last_flow for Fresh wallets ---
    fresh = [h for h in data["top_holders"] if h.get("type") == "FRESH"]
    print(f"🔧 Backfilling {len(fresh)} fresh wallets...")

    backfilled = 0
    for h in fresh:
        addr = h["address"].lower()
        needs_created = not h.get("wallet_created")
        needs_flow = not h.get("last_flow")

        if not needs_created and not needs_flow:
            continue

        if needs_created:
            ts = get_first_tx(addr)
            if ts:
                h["wallet_created"] = ts
                # Also update fresh_cache
                if addr in cache:
                    cache[addr]["first_ts"] = ts
                print(f"  ✅ {addr[:14]}... wallet_created = {ts}")
            time.sleep(0.25)

        if needs_flow:
            li_ts, li_amt = get_last_zro_transfer(addr)
            if li_ts:
                h["last_flow"] = li_ts
                h["last_flow_amount"] = li_amt
                print(f"  ✅ {addr[:14]}... last_flow = {li_ts}, amount = {li_amt:+,.0f}")
            time.sleep(0.25)

        backfilled += 1

    # --- 2. Clean zero-balance holders ---
    before = len(data["top_holders"])
    data["top_holders"] = [h for h in data["top_holders"] if sum(h.get("balances", {}).values()) > 0]
    removed = before - len(data["top_holders"])
    print(f"🧹 Removed {removed} zero-balance holders ({before} → {len(data['top_holders'])})")

    # --- 3. Remove duplicates ---
    seen = set()
    deduped = []
    for h in data["top_holders"]:
        addr = h["address"].lower()
        if addr not in seen:
            seen.add(addr)
            deduped.append(h)
    dup_count = len(data["top_holders"]) - len(deduped)
    if dup_count:
        print(f"🔄 Removed {dup_count} duplicate holders")
    data["top_holders"] = deduped

    # Save
    atomic_json_dump(data, DATA_PATH)
    if cache:
        atomic_json_dump(cache, CACHE_PATH)

    print(f"\n✅ Done! Backfilled {backfilled} wallets, cleaned {removed} zeros, {dup_count} dupes")


if __name__ == "__main__":
    main()
