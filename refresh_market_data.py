"""Persist validated CoinGecko market data independently of wallet refreshes."""
import json
import math
from pathlib import Path
from utils import atomic_json_dump, fetch_json

DATA_PATH = Path(__file__).resolve().parent / "zro_data.json"
MARKET_URL = "https://api.coingecko.com/api/v3/coins/layerzero?localization=false&tickers=false&community_data=false&developer_data=false"


def apply_market_data(data, response):
    market = response.get("market_data", {})
    price = market.get("current_price", {}).get("usd")
    circulating = market.get("circulating_supply")
    total = market.get("total_supply")
    values = (price, circulating, total)
    if not all(isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) for value in values):
        raise ValueError("Incomplete or invalid CoinGecko market data")
    if price <= 0 or not 0 <= circulating <= total or total <= 0:
        raise ValueError("Invalid price or supply range")
    updated = market.get("last_updated") or response.get("last_updated")
    if not updated:
        raise ValueError("Market data has no source timestamp")
    meta = data.setdefault("meta", {})
    meta.update(price_usd=price, circulating_supply=circulating,
                market_cap=round(price * circulating, 2), fdv=round(price * total, 2),
                market_data_updated=updated, market_data_source="CoinGecko")
    change = market.get("price_change_percentage_24h")
    if isinstance(change, (int, float)) and math.isfinite(change):
        meta["price_change_24h"] = change


def main():
    response = fetch_json(MARKET_URL)
    if not response:
        raise RuntimeError("CoinGecko unavailable; keeping prior market data")
    data = json.loads(DATA_PATH.read_text())
    apply_market_data(data, response)
    atomic_json_dump(data, DATA_PATH)
    print(f"Market data updated: {data['meta']['market_data_updated']}")


if __name__ == "__main__":
    main()
