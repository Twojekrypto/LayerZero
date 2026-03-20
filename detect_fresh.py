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
MIN_BALANCE_FOR_CHECK = 10_000  # Only check wallets with >10K ZRO
FRESH_AGE_DAYS = 30  # Wallet younger than this = FRESH

# Known multi-sig deployers — wallets created by these are institutional
KNOWN_DEPLOYERS = {
    "0x5e2e302ba028f33845fcb107dd8a6b55f42e92a0",  # BitGo deployer
    "0x41274f7674333a7e5b3215e4c7af51eb4cc7cedb",  # Gnosis Safe deployer (LZ)
}

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


def get_first_tx_timestamp(address):
    """Get the timestamp of the address's first-ever transaction on Ethereum (for EOAs)."""
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
        # Try token transactions
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

    for h in candidates:
        addr = h["address"]
        total = sum(h.get("balances", {}).values())
        checked += 1

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
                    print(f"  🏛️ NEW INST: {addr[:14]}... ({total:,.0f} ZRO, contract {wallet_age}d old, deployer: {deployer[:10]}...)")
                else:
                    h["label"] = "Fresh Wallet"
                    h["type"] = "FRESH"
                    new_fresh += 1
                    print(f"  🟢 FRESH: {addr[:14]}... ({total:,.0f} ZRO, contract {wallet_age}d old)")
            elif deployer and deployer in KNOWN_DEPLOYERS:
                wallet_age = (now - creation_ts) // 86400 if creation_ts else 0
                skipped_contracts += 1
                print(f"  🏛️ OLD INST: {addr[:14]}... ({total:,.0f} ZRO, contract {wallet_age}d old)")
            elif creation_ts:
                wallet_age = (now - creation_ts) // 86400
                print(f"  ⚪ OLD:   {addr[:14]}... ({total:,.0f} ZRO, contract {wallet_age}d old)")
            else:
                print(f"  ❓ SKIP:  {addr[:14]}... ({total:,.0f} ZRO, contract, no creation data)")
        else:
            # For EOAs: check first transaction date
            first_ts = get_first_tx_timestamp(addr)
            time.sleep(0.25)

            if first_ts and first_ts > cutoff:
                wallet_age = (now - first_ts) // 86400
                h["label"] = "Fresh Wallet"
                h["type"] = "FRESH"
                new_fresh += 1
                print(f"  🟢 FRESH: {addr[:14]}... ({total:,.0f} ZRO, EOA {wallet_age}d old)")
            elif first_ts:
                wallet_age = (now - first_ts) // 86400
                print(f"  ⚪ OLD:   {addr[:14]}... ({total:,.0f} ZRO, EOA {wallet_age}d old)")
            else:
                print(f"  ❓ SKIP:  {addr[:14]}... ({total:,.0f} ZRO, no TX found)")

        # Progress
        if checked % 50 == 0:
            print(f"   ... checked {checked}/{len(candidates)}")

    print()
    print(f"✅ Done!")
    print(f"   New FRESH wallets: {new_fresh}")
    print(f"   New INSTITUTIONAL wallets: {new_inst}")
    print(f"   Old institutional contracts: {skipped_contracts}")

    if new_fresh > 0 or new_inst > 0:
        with open(DATA_PATH, "w") as f:
            json.dump(data, f, indent=2)
        print(f"💾 Saved to {DATA_PATH}")
    else:
        print("   No changes needed")


if __name__ == "__main__":
    main()
