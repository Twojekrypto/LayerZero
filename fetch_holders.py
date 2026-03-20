#!/usr/bin/env python3
"""
Fetch all ZRO token holders across 5 Etherscan-compatible chains.
Uses tokentx (free) endpoint to get all transfers, then computes balances.
Filters for holders with > 10 ZRO.
Outputs merged JSON for the dashboard.
"""
import json, time, sys, os
from urllib.request import urlopen, Request
from collections import defaultdict

API_KEY = os.environ.get("ETHERSCAN_API_KEY", "")
ZRO_CONTRACT = "0x6985884c4392d348587b19cb9eaaf157f13271cd"
MIN_BALANCE = 10  # Only include holders with >10 ZRO
DECIMALS = 18
ZERO = "0x0000000000000000000000000000000000000000"

# Etherscan V2 supports chainid parameter
CHAINS = {
    "ethereum":  {"chainid": 1,     "name": "Ethereum",  "short": "ETH"},
    "arbitrum":  {"chainid": 42161, "name": "Arbitrum",  "short": "ARB"},
    "base":      {"chainid": 8453,  "name": "Base",      "short": "BASE"},
    "bsc":       {"chainid": 56,    "name": "BNB Chain", "short": "BSC"},
    "optimism":  {"chainid": 10,    "name": "Optimism",  "short": "OP"},
    "polygon":   {"chainid": 137,   "name": "Polygon",   "short": "POLY"},
    "avalanche": {"chainid": 43114, "name": "Avalanche", "short": "AVAX"},
}

def fetch_json(url):
    """Fetch JSON from URL with retry."""
    for attempt in range(3):
        try:
            req = Request(url, headers={"User-Agent": "ZRO-Dashboard/1.0"})
            with urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode())
        except Exception as e:
            print(f"  ⚠️ Attempt {attempt+1} failed: {e}")
            time.sleep(2)
    return None

def fetch_all_transfers(chainid):
    """Fetch ALL token transfers for ZRO on a given chain using pagination."""
    all_txs = []
    page = 1
    offset = 10000  # max per page
    
    while True:
        url = (
            f"https://api.etherscan.io/v2/api?chainid={chainid}"
            f"&module=account&action=tokentx"
            f"&contractaddress={ZRO_CONTRACT}"
            f"&page={page}&offset={offset}&sort=asc"
            f"&apikey={API_KEY}"
        )
        
        data = fetch_json(url)
        if not data:
            break
            
        if data.get("status") != "1" or not data.get("result"):
            if page == 1:
                msg = data.get("result", data.get("message", "Unknown error"))
                print(f"  ⚠️ API returned: {msg}")
            break
        
        results = data["result"]
        all_txs.extend(results)
        print(f"  📦 Page {page}: {len(results)} transfers (total: {len(all_txs)})")
        
        if len(results) < offset:
            break  # Last page
        
        page += 1
        time.sleep(0.25)  # Rate limit: 5 req/s free tier
    
    return all_txs

def compute_balances(transfers):
    """Compute current balances from transfer history."""
    balances = defaultdict(int)
    
    for tx in transfers:
        value = int(tx.get("value", "0"))
        from_addr = tx.get("from", "").lower()
        to_addr = tx.get("to", "").lower()
        
        if from_addr and from_addr != ZERO:
            balances[from_addr] -= value
        if to_addr and to_addr != ZERO:
            balances[to_addr] += value
    
    # Convert to float (18 decimals) and filter > MIN_BALANCE
    result = {}
    for addr, raw_balance in balances.items():
        balance = raw_balance / (10 ** DECIMALS)
        if balance > MIN_BALANCE:
            result[addr] = round(balance, 2)
    
    return result

def main():
    print("🔍 ZRO Multi-Chain Holder Fetcher")
    print(f"   Contract: {ZRO_CONTRACT}")
    print(f"   Min balance: {MIN_BALANCE} ZRO")
    print(f"   Chains: {', '.join(c['short'] for c in CHAINS.values())}")
    print()
    
    all_holders = {}  # addr -> {chain: balance, ...}
    chain_stats = {}
    
    for chain_key, chain_info in CHAINS.items():
        chainid = chain_info["chainid"]
        print(f"🔗 [{chain_info['short']}] Fetching transfers (chainid={chainid})...")
        
        transfers = fetch_all_transfers(chainid)
        print(f"   Total transfers: {len(transfers)}")
        
        if not transfers:
            print(f"   ⚠️ No transfers found, skipping")
            chain_stats[chain_key] = {"transfers": 0, "holders_gt10": 0}
            continue
        
        balances = compute_balances(transfers)
        print(f"   Holders with >{MIN_BALANCE} ZRO: {len(balances)}")
        
        chain_stats[chain_key] = {
            "transfers": len(transfers),
            "holders_gt10": len(balances)
        }
        
        # Merge into all_holders
        for addr, balance in balances.items():
            if addr not in all_holders:
                all_holders[addr] = {"balances": {}}
            all_holders[addr]["balances"][chain_key] = balance
        
        print(f"   ✅ Done! Unique addresses so far: {len(all_holders)}")
        print()
        time.sleep(1)  # Rate limit between chains
    
    # Build output
    holders_list = []
    for addr, data in all_holders.items():
        total = sum(data["balances"].values())
        if total > MIN_BALANCE:
            holders_list.append({
                "address": addr,
                "label": "",
                "type": "WALLET",
                "balances": data["balances"],
                "total": round(total, 2)
            })
    
    # Sort by total descending
    holders_list.sort(key=lambda x: x["total"], reverse=True)
    
    # Print summary
    print("=" * 60)
    print(f"📊 RESULTS SUMMARY")
    print(f"   Total unique addresses (>{MIN_BALANCE} ZRO): {len(holders_list)}")
    for ck, cs in chain_stats.items():
        print(f"   {CHAINS[ck]['short']}: {cs['transfers']} transfers → {cs['holders_gt10']} holders")
    print(f"   Top 5 holders:")
    for h in holders_list[:5]:
        chains = ", ".join(f"{k}:{v:,.0f}" for k,v in h["balances"].items())
        print(f"     {h['address'][:10]}… = {h['total']:,.0f} ZRO ({chains})")
    print()
    
    # Save output
    output_file = os.path.join(os.path.dirname(__file__), "holders_multichain.json")
    with open(output_file, "w") as f:
        json.dump({
            "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "min_balance": MIN_BALANCE,
            "total_holders": len(holders_list),
            "chain_stats": chain_stats,
            "holders": holders_list
        }, f, indent=2)
    
    print(f"💾 Saved to {output_file}")
    print(f"   {len(holders_list)} holders ready for dashboard!")

if __name__ == "__main__":
    main()
