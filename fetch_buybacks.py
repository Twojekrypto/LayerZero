#!/usr/bin/env python3
"""Auto-fetch ZRO buybacks from the LayerZero Foundation tracker.

The tracker (https://layerzero.foundation/zro-buybacks) is a Next.js SSG page
with buyback data baked into the page's JS chunk as objects shaped like:
    {zroPurchased:124574.01,usdPrice:143217.01,source:"Stargate",date:new Date("2026-05-31T12:00:00")}

Strategy:
 1. GET the page HTML, find the zro-buybacks chunk URL.
 2. GET the chunk, regex out all buyback entries.
 3. Update buybacks.stargate_monthly / totals in zro_data.json.

Fail-safe: on ANY error the script logs a warning and exits 0 without
modifying zro_data.json, so the existing (manually curated) data survives.
"""
import json
import re
import sys
from datetime import datetime
from urllib.request import Request, urlopen

from utils import atomic_json_dump

BASE = "https://layerzero.foundation"
PAGE_URL = f"{BASE}/zro-buybacks"
DATA_FILE = "zro_data.json"

CHUNK_RE = re.compile(r'(/_next/static/chunks/pages/zro-buybacks-[a-f0-9]+\.js)')
# Tolerate key reordering and minor format drift within the object literal.
ENTRY_RE = re.compile(
    r'\{[^{}]*?zroPurchased\s*:\s*([\d.]+)[^{}]*?'
    r'usdPrice\s*:\s*([\d.]+)[^{}]*?'
    r'source\s*:\s*"([^"]+)"[^{}]*?'
    r'new Date\("([^"]+)"\)[^{}]*?\}'
)


def http_get(url, timeout=30):
    req = Request(url, headers={"User-Agent": "ZRO-Dashboard/1.0"})
    with urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def parse_entries(chunk_js):
    entries = []
    for tokens, usd, source, date_str in ENTRY_RE.findall(chunk_js):
        try:
            dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        except ValueError:
            continue
        entries.append({
            "tokens": round(float(tokens)),
            "usd": round(float(usd)),
            "source": source,
            "_dt": dt,
        })
    entries.sort(key=lambda e: e["_dt"])
    return entries


def main():
    try:
        html = http_get(PAGE_URL)
        m = CHUNK_RE.search(html)
        if not m:
            print("⚠️  fetch_buybacks: chunk URL not found in page HTML — tracker layout changed?")
            return 0
        chunk_js = http_get(BASE + m.group(1))
        entries = parse_entries(chunk_js)
        stargate = [e for e in entries if e["source"].lower() == "stargate"]
        if len(stargate) < 6:
            print(f"⚠️  fetch_buybacks: only {len(stargate)} Stargate entries parsed — refusing to overwrite")
            return 0

        with open(DATA_FILE) as f:
            data = json.load(f)
        b = data.setdefault("buybacks", {})
        b["stargate_monthly"] = [
            {"month": e["_dt"].strftime("%b %Y"), "tokens": e["tokens"], "usd": e["usd"]}
            for e in stargate
        ]
        b["stargate_total_tokens"] = sum(e["tokens"] for e in stargate)
        b["stargate_total_usd"] = sum(e["usd"] for e in stargate)
        b["tracker_updated"] = datetime.utcnow().strftime("%Y-%m-%d")
        atomic_json_dump(data, DATA_FILE)
        print(f"✅ fetch_buybacks: {len(stargate)} months, total {b['stargate_total_tokens']:,} ZRO / ${b['stargate_total_usd']:,}")
        return 0
    except Exception as exc:  # noqa: BLE001 — fail-safe by design
        print(f"⚠️  fetch_buybacks failed (keeping existing data): {exc}")
        return 0


if __name__ == "__main__":
    sys.exit(main())
