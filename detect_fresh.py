#!/usr/bin/env python3
"""
Auto-detect Fresh & New Institutional Wallets + Coinbase Prime Investors.
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
from utils import atomic_json_dump, fetch_json, get_api_key

API_KEY = get_api_key()
DISCORD_WEBHOOK_URL = os.environ.get("DISCORD_WEBHOOK_URL", "")
MIN_BALANCE_FOR_CHECK = 10_000  # Only check wallets with >10K ZRO
FRESH_AGE_DAYS = 30  # Wallet younger than this = FRESH

# Known multi-sig deployers — wallets created by these are institutional
KNOWN_DEPLOYERS = {
    "0x5e2e302ba028f33845fcb107dd8a6b55f42e92a0",  # BitGo deployer
    "0x41274f7674333a7e5b3215e4c7af51eb4cc7cedb",  # Gnosis Safe deployer (LZ)
}

# Coinbase Prime custody hub addresses — wallets funded by these are institutional investors
COINBASE_PRIME_HUBS = {
    "0xcd531ae9efcce479654c4926dec5f6209531ca7b",  # Coinbase Prime 1 (Etherscan-labeled)
}
ZRO_CONTRACT = "0x6985884c4392d348587b19cb9eaaf157f13271cd"
CB_MIN_RECEIVED = 50_000  # Min ZRO received from CB Prime to qualify
CB_MIN_BALANCE = 100_000  # Min current balance to label

# Manually excluded internal Coinbase wallets (frequent CB Prime ↔ Coinbase transfers)
COINBASE_INTERNAL_EXCLUDE = {
    "0x26cc9d27b6dfa373a7a470839e4cf5220a22be02",
    "0xd23b59111d168760c8eea27b01cf8f21369a7040",
    "0x94e19e5c29a75b1b1bdcf247bb55425ca7d319d4",
    "0x1e51767f345b1a7404fac03828e02a3fbceb4c95",
    "0xaeee6e35eb33a464a82a51dbf52e85da137b6bcc",
    "0x3fceb80de2a6fd3b46ab792f22858bbb24dd9e41",

    "0x9e17093991868768613dae0e857437076eef0ee9",  # CB Prime operational (688K ZRO, 27 tx)
}

# Known Coinbase exchange hot wallets — used to detect internal shuttle wallets
KNOWN_COINBASE_WALLETS = {
    "0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43",
    "0x503828976d22510aad0201ac7ec88293211d23da",
    "0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740",
    "0x3cd751e6b0078be393132286c442345e68ff0afc",
    "0xb5d85cbf7cb3ee0d56b3bb207d5fc4b82f43f511",
    "0xeb2629a2734e272bcc07bda959863f316f4bd4cf",
    "0x6e1abc08ad3a845726ac93c0715be2d7c9e7129b",
    "0x137f79a70fc9c6d5c80f94a5fc44bd95a567652d",
    "0xaeee6e35eb33a464a82a51dbf52e85da137b6bcc",
    "0x94e19e5c29a75b1b1bdcf247bb55425ca7d319d4",
} | COINBASE_PRIME_HUBS  # Include the hub itself

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
    atomic_json_dump(cache, CACHE_PATH)


def get_funding_source(address, label_map):
    """Check who sent ZRO to this address. Returns (label, last_flow_ts, last_flow_amount).
    last_flow_amount is positive for inflows, negative for outflows.
    Uses 1 API call — fetches last 20 ZRO transfers."""
    url = (
        f"https://api.etherscan.io/v2/api?chainid=1"
        f"&module=account&action=tokentx"
        f"&address={address}"
        f"&contractaddress={ZRO_CONTRACT}"
        f"&startblock=0&endblock=99999999"
        f"&page=1&offset=20&sort=desc"
        f"&apikey={API_KEY}"
    )
    data = fetch_json(url)
    if not data or data.get("status") != "1" or not data.get("result"):
        return None, 0, 0

    # Find biggest labeled sender + latest flow (in or out)
    senders = {}  # label -> total ZRO
    last_flow_ts = 0
    last_flow_amount = 0
    for tx in data["result"]:
        val = int(tx.get("value", "0")) / 1e18
        ts = int(tx.get("timeStamp", "0"))
        to_addr = tx.get("to", "").lower()
        from_addr = tx.get("from", "").lower()
        # Track latest flow regardless of direction
        if ts > last_flow_ts and val > 0:
            last_flow_ts = ts
            last_flow_amount = val if to_addr == address else -val
        # Track labeled senders (inflows only)
        if to_addr == address:
            label = label_map.get(from_addr)
            if label:
                senders[label] = senders.get(label, 0) + val

    best = max(senders, key=senders.get) if senders else None
    return best, last_flow_ts, last_flow_amount


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
    "0x28c6c06298d514db089934071355e5743bf21d60",
    "0x21a31ee1afc51d94c2efccaa2092ad1028285549",
    "0xdfd5293d8e347dfe59e90efd55b2956a1343963d",
    "0x56eddb7aa87536c09ccc2793473599fd21a8b17f",
    "0xb5bc3e38b5b683ce357ffd04d70354dcbbf813b2",
    "0xf977814e90da44bfa03b6295a0616a897441acec",
    "0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43",
    "0x503828976d22510aad0201ac7ec88293211d23da",
    "0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740",
    "0x3cd751e6b0078be393132286c442345e68ff0afc",
    "0xb5d85cbf7cb3ee0d56b3bb207d5fc4b82f43f511",
    "0xeb2629a2734e272bcc07bda959863f316f4bd4cf",
    "0xcd531ae9efcce479654c4926dec5f6209531ca7b",
    "0x6e1abc08ad3a845726ac93c0715be2d7c9e7129b",
    "0x137f79a70fc9c6d5c80f94a5fc44bd95a567652d",
    "0xaeee6e35eb33a464a82a51dbf52e85da137b6bcc",
    "0x94e19e5c29a75b1b1bdcf247bb55425ca7d319d4",
    "0x6cc5f688a315f3dc28a7781717a9a798a59fda7b",
    "0x98ec059dc3adfbdd63429227115d9f17bebe7455",
    "0x6cC5F688a315f3dC28A7781717a9A798a59fDA7b",
    "0x4a4aaa0155237881fbd5c34bfae16e985a7b068d",
    "0x75e89d5979e4f6fba9f97c104c2f0afb3f1dcb88",
    "0xf89d7b9c864f589bbf53a82105107622b35eaa40",
    "0x1ab4973a48dc892cd9971ece8e01dcc7688f8f23",
    "0xd9d93951896b4ef97d251334ef2a0e39f6f6d7d7",
    "0x2faf487a4414fe77e2327f0bf4ae2a264a776ad2",
    "0x0d0707963952f2fba59dd06f2b425ace40b492fe",
    "0xd793281b45cebbdc1e30e3e3e47d7c5e7713e23d",
    "0x46340b20830761efd32832a74d7169b29feb9758",
    "0xb8e6d31e7b212b2b7250ee9c26c56cebbfbe6b23",
    "0x63be42b40816eb08f6ea480e5875e6f4668da379",
    "0xfdd710fa25cf1e08775cb91a2bf65f1329ccbd09",
    "0x6540f4a2f4c4fbac288fa738a249924a636020d0",
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
    has_deposit = False
    for tx in data["result"]:
        from_addr = tx.get("from", "").lower()
        to_addr = tx.get("to", "").lower()
        if from_addr in KNOWN_CEX_HOT_WALLETS or to_addr in KNOWN_CEX_HOT_WALLETS:
            cex_interactions += 1
        # If the wallet sends ZRO TO a CEX, it is likely an arbitrageur or cashing out, NOT a fresh accumulator
        if to_addr in KNOWN_CEX_HOT_WALLETS:
            has_deposit = True

    # Reject if it transferred TO a CEX (deposit) OR if it has multiple interactions (CEX hot wallet proxy)
    return has_deposit or cex_interactions >= 2


def has_coinbase_roundtrip(address, cache=None):
    """Check if a wallet has frequent ZRO transfers TO Coinbase hot wallets or CB Prime.
    If a wallet sends ZRO back to Coinbase addresses frequently, it's an internal wallet,
    not an actual investor. Results are cached in fresh_cache to avoid redundant API calls."""
    # Check cache first
    if cache is not None:
        cached = cache.get(address, {})
        if "cb_roundtrip" in cached:
            return cached["cb_roundtrip"]

    url = (
        f"https://api.etherscan.io/v2/api?chainid=1"
        f"&module=account&action=tokentx"
        f"&address={address}"
        f"&contractaddress={ZRO_CONTRACT}"
        f"&startblock=0&endblock=99999999"
        f"&page=1&offset=200&sort=desc"
        f"&apikey={API_KEY}"
    )
    data = fetch_json(url)
    if not data or data.get("status") != "1" or not data.get("result"):
        return False

    cb_transfers = 0
    total_out = 0
    total_in = 0
    large_out_count = 0  # transfers OUT > 10K ZRO
    for tx in data["result"]:
        from_addr = tx.get("from", "").lower()
        to_addr = tx.get("to", "").lower()
        value = int(tx.get("value", "0")) / 1e18

        if from_addr == address.lower():
            total_out += 1
            if value >= 10_000:
                large_out_count += 1
            if to_addr in KNOWN_COINBASE_WALLETS:
                cb_transfers += 1
        elif to_addr == address.lower():
            total_in += 1
            if from_addr in (KNOWN_COINBASE_WALLETS - COINBASE_PRIME_HUBS):
                cb_transfers += 1

    total_tx = len(data["result"])

    # Heuristic 1: sends TO known Coinbase wallets (original check)
    is_roundtrip = cb_transfers >= 3

    # Heuristic 2: CB Prime internal/operational wallet pattern
    # Very conservative thresholds to avoid filtering real investors:
    # - >100 ZRO transfers = high-volume settlement (investors have <50)
    # - 10+ large OUTs (>10K ZRO) = systematic sweeping
    # - 15+ total OUTs = not just occasional sends to other investors
    # Example: 0x63be has 231 tx, 100+ large OUTs → operational ✅
    # Example: 0x02546e has 2x deposits → investor, NOT filtered ✅
    is_operational = (total_tx >= 100 and large_out_count >= 10 and total_out >= 15)

    result = is_roundtrip or is_operational

    if result and not is_roundtrip:
        print(f"  ⛔ Filtered (operational pattern: {total_tx} tx, {large_out_count} large OUT): {address[:14]}...")

    # Save to cache
    if cache is not None:
        if address not in cache:
            cache[address] = {}
        cache[address]["cb_roundtrip"] = result

    return result


def detect_coinbase_prime(data, cache=None):
    """Auto-detect wallets funded by Coinbase Prime custody hubs.
    Scans outgoing ZRO transfers from known CB Prime addresses,
    labels recipients with 100K+ balance as 'Coinbase Prime Investor'.

    Filters out internal Coinbase wallets that shuttle funds between
    Coinbase hot wallets and CB Prime (detected via round-trip transfers)."""
    print("🏦 Coinbase Prime Investor Detection")

    existing_cb = {h["address"].lower() for h in data["top_holders"]
                   if h.get("label") == "Coinbase Prime Investor"}
    balance_map = {h["address"].lower(): sum(h.get("balances", {}).values())
                   for h in data["top_holders"]}

    # Scan outgoing ZRO transfers from each CB Prime hub
    all_recipients = {}  # addr -> {total, first_ts, last_ts}
    for hub in COINBASE_PRIME_HUBS:
        page = 1
        while True:
            url = (
                f"https://api.etherscan.io/v2/api?chainid=1"
                f"&module=account&action=tokentx"
                f"&address={hub}"
                f"&contractaddress={ZRO_CONTRACT}"
                f"&startblock=0&endblock=99999999"
                f"&page={page}&offset=100&sort=desc"
                f"&apikey={API_KEY}"
            )
            resp = fetch_json(url)
            if not resp or resp.get("status") != "1" or not resp.get("result"):
                break
            for tx in resp["result"]:
                if tx.get("from", "").lower() == hub:
                    to = tx.get("to", "").lower()
                    val = int(tx.get("value", "0")) / 1e18
                    ts = int(tx.get("timeStamp", "0"))
                    if to not in all_recipients:
                        all_recipients[to] = {"total": 0, "first_ts": ts, "last_ts": ts, "last_amount": val}
                    all_recipients[to]["total"] += val
                    all_recipients[to]["first_ts"] = min(all_recipients[to]["first_ts"], ts)
                    if ts >= all_recipients[to]["last_ts"]:
                        all_recipients[to]["last_ts"] = ts
                        all_recipients[to]["last_amount"] = val
            if len(resp["result"]) < 100:
                break
            page += 1
            time.sleep(0.25)

    print(f"   Outgoing transfers to {len(all_recipients)} unique recipients")

    # Update timestamps for ALL existing CB Prime wallets (even already labeled)
    cb_updated = 0
    for h in data["top_holders"]:
        addr = h["address"].lower()
        info = all_recipients.get(addr)
        if info and h.get("label") == "Coinbase Prime Investor":
            h["cb_first_funded"] = info["first_ts"]
            h["cb_last_funded"] = info["last_ts"]
            h["cb_total_received"] = round(info["total"])
            h["cb_last_flow_amount"] = round(info.get("last_amount", 0))
            cb_updated += 1
    print(f"   Updated metadata for {cb_updated} existing CB Prime wallets")

    new_labeled = 0
    relabeled = 0
    new_cb_wallets = []  # For Discord alerts
    for h in data["top_holders"]:
        addr = h["address"].lower()
        info = all_recipients.get(addr)
        if not info or info["total"] < CB_MIN_RECEIVED:
            continue
        balance = balance_map.get(addr, 0)
        if balance < CB_MIN_BALANCE:
            continue
        if addr in existing_cb:
            continue  # Already labeled
        # Skip manually excluded internal Coinbase wallets
        if addr in COINBASE_INTERNAL_EXCLUDE:
            print(f"  ⛔ Excluded (internal): {addr[:14]}...")
            continue
        # Skip wallets with non-Fresh manual labels (BitGo, CEX, etc.)
        existing_label = h.get("label", "")
        existing_type = h.get("type", "")
        if existing_label and existing_type not in ("FRESH", ""):
            continue
        # Auto-filter: skip if wallet has frequent round-trip transfers with Coinbase
        time.sleep(0.25)
        if has_coinbase_roundtrip(addr, cache):
            print(f"  ⛔ Filtered (CB roundtrip): {addr[:14]}... ({balance:,.0f} ZRO)")
            continue
        old_label = existing_label or "(none)"
        h["label"] = "Coinbase Prime Investor"
        h["type"] = "INST"
        h["cb_first_funded"] = info["first_ts"]
        h["cb_last_funded"] = info["last_ts"]
        h["cb_total_received"] = round(info["total"])
        h["cb_last_flow_amount"] = round(info.get("last_amount", 0))
        if old_label == "Fresh Wallet":
            relabeled += 1
            print(f"  🔄 Relabeled: {addr[:14]}... {old_label} → CB Prime ({balance:,.0f} ZRO)")
        else:
            new_labeled += 1
            print(f"  🆕 CB Prime:  {addr[:14]}... ({balance:,.0f} ZRO, received {info['total']:,.0f})")
        new_cb_wallets.append({"address": addr, "balance": balance, "type": "CB_PRIME"})

    total_cb = sum(1 for h in data["top_holders"] if h.get("label") == "Coinbase Prime Investor")
    print(f"   Total CB Prime wallets: {total_cb} (new: {new_labeled}, relabeled: {relabeled})")

    # Prune cb_prime_transfers to last 1000 entries
    transfers = data.get("cb_prime_transfers", [])
    if len(transfers) > 1000:
        data["cb_prime_transfers"] = transfers[-1000:]
        print(f"   Pruned cb_prime_transfers: {len(transfers)} → 1000")

    print()
    return new_cb_wallets, cb_updated


def main():
    if not API_KEY:
        print("❌ ETHERSCAN_API_KEY not set")
        return

    with open(DATA_PATH) as f:
        data = json.load(f)

    # Build label_map for funding source detection
    label_map = {}
    for h in data["top_holders"]:
        lbl = h.get("label", "")
        if lbl:
            label_map[h["address"].lower()] = lbl

    # ── Phase 0: Age out expired FRESH/NEW_INST labels ──
    cache = load_cache()
    now = int(time.time())
    cutoff = now - (FRESH_AGE_DAYS * 86400)
    aged_out = 0
    for h in data["top_holders"]:
        addr = h["address"].lower()
        if h.get("type") in ("FRESH", "NEW_INST"):
            cached = cache.get(addr, {})
            first_ts = cached.get("first_ts", 0)
            if first_ts and (now - first_ts) > (FRESH_AGE_DAYS * 86400):
                old_label = h.get("label", "")
                h["label"] = ""
                h["type"] = ""
                cache[addr] = {"result": "OLD", "checked": now}
                aged_out += 1
                print(f"  ⏰ Aged out: {addr[:14]}... (was: {old_label})")
    if aged_out:
        print(f"   Expired {aged_out} fresh/institutional labels")
    print()

    # Phase 1: Coinbase Prime detection (before fresh wallet scan)
    cb_wallets, cb_updated = detect_coinbase_prime(data, cache)

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
        # Still save data if aging or CB detection changed something
        if aged_out > 0 or len(cb_wallets) > 0:
            save_cache(cache)
            atomic_json_dump(data, DATA_PATH)
            print(f"💾 Saved changes")
        return

    new_fresh = 0
    new_inst = 0
    skipped_contracts = 0
    checked = 0
    cache_hits = 0
    relabeled = 0
    new_wallets = []  # Collect for Discord alerts

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
                # Still fresh — ensure label is applied (may have been lost during merge)
                first_ts = cached.get("first_ts", 0)
                if not h.get("type") or h.get("type") not in ("FRESH", "NEW_INST"):
                    h["label"] = "Fresh Wallet" if result == "FRESH" else "New Institutional"
                    h["type"] = result
                    # Check funding source + last inflow
                    funder, li_ts, li_amt = get_funding_source(addr, label_map)
                    if funder:
                        h["funded_by"] = funder
                        print(f"     💰 Funded by: {funder}")
                    if li_ts:
                        h["last_flow"] = li_ts
                        h["last_flow_amount"] = li_amt
                    time.sleep(0.25)
                    relabeled += 1
                    print(f"  🔄 Re-labeled {addr[:14]}... as {result} (label was missing)")
                # Always ensure wallet_created is set from cache
                if first_ts and not h.get("wallet_created"):
                    h["wallet_created"] = first_ts
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
                        h["wallet_created"] = creation_ts
                        funder, li_ts, li_amt = get_funding_source(addr, label_map)
                        if funder:
                            h["funded_by"] = funder
                        if li_ts:
                            h["last_flow"] = li_ts
                            h["last_flow_amount"] = li_amt
                        time.sleep(0.25)
                        new_fresh += 1
                        cache[addr] = {"result": "FRESH", "first_ts": creation_ts, "checked": now_ts}
                        new_wallets.append({"address": addr, "balance": total, "age_days": wallet_age, "type": "FRESH", "wallet_type": "Contract", "funded_by": funder or ""})
                        print(f"  🟢 FRESH: {addr[:14]}... ({total:,.0f} ZRO, contract {wallet_age}d old{', via '+funder if funder else ''})")
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
                        h["wallet_created"] = first_ts
                        funder, li_ts, li_amt = get_funding_source(addr, label_map)
                        if funder:
                            h["funded_by"] = funder
                        if li_ts:
                            h["last_flow"] = li_ts
                            h["last_flow_amount"] = li_amt
                        time.sleep(0.25)
                        new_fresh += 1
                        cache[addr] = {"result": "FRESH", "first_ts": first_ts, "checked": now_ts}
                        new_wallets.append({"address": addr, "balance": total, "age_days": wallet_age, "type": "FRESH", "wallet_type": "EOA", "funded_by": funder or ""})
                        print(f"  🟢 FRESH: {addr[:14]}... ({total:,.0f} ZRO, EOA {wallet_age}d old{', via '+funder if funder else ''})")
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

    has_changes = new_fresh > 0 or new_inst > 0 or len(cb_wallets) > 0 or cb_updated > 0 or aged_out > 0 or relabeled > 0
    if has_changes:
        atomic_json_dump(data, DATA_PATH)
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

        fields = [
                {"name": "Address", "value": f"[`{short_addr}`]({etherscan_url})", "inline": True},
                {"name": "Balance", "value": f"**{balance:,.0f} ZRO**{usd_val}", "inline": True},
                {"name": "Age", "value": f"{w['age_days']} days", "inline": True},
                {"name": "Type", "value": w["wallet_type"], "inline": True},
            ]
        if w.get("funded_by"):
            fields.append({"name": "💰 Funded by", "value": f"**{w['funded_by']}**", "inline": True})
        fields.append({"name": "Links", "value": f"[Etherscan]({etherscan_url}) · [DeBank]({debank_url})", "inline": False})

        embed = {
            "title": title,
            "color": color,
            "fields": fields,
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
