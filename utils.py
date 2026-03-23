#!/usr/bin/env python3
"""
Shared utilities for ZRO Dashboard scripts.
- Atomic JSON writes (crash-safe)
- Common HTTP fetch with retry
"""
import json, os, time
from urllib.request import urlopen, Request


def atomic_json_dump(data, path, indent=2):
    """Write JSON atomically: write to .tmp then rename.
    If process crashes mid-write, the original file stays intact."""
    tmp_path = path + ".tmp"
    with open(tmp_path, "w") as f:
        json.dump(data, f, indent=indent)
    os.replace(tmp_path, path)


def fetch_json(url, retries=3, delay=2):
    """Fetch JSON from URL with retry logic."""
    for attempt in range(retries):
        try:
            req = Request(url, headers={"User-Agent": "ZRO-Dashboard/1.0"})
            with urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode())
        except Exception as e:
            if attempt < retries - 1:
                print(f"  ⚠️ Attempt {attempt+1} failed: {e}")
                time.sleep(delay)
    return None
