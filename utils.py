#!/usr/bin/env python3
"""
Shared utilities for ZRO Dashboard scripts.
- Atomic JSON writes (crash-safe)
- Common HTTP fetch with retry
- Etherscan API key management with automatic fallback
"""
import json, os, re, time
from urllib.request import urlopen, Request


def atomic_json_dump(data, path, indent=2):
    """Write JSON atomically: write to .tmp then rename.
    If process crashes mid-write, the original file stays intact."""
    tmp_path = path + ".tmp"
    with open(tmp_path, "w") as f:
        json.dump(data, f, indent=indent)
    os.replace(tmp_path, path)


# --- Etherscan API key fallback ---
_api_keys = []
_current_key_idx = 0


def get_api_key():
    """Get current Etherscan API key with automatic fallback."""
    global _api_keys, _current_key_idx
    if not _api_keys:
        k1 = os.environ.get("ETHERSCAN_API_KEY", "")
        k2 = os.environ.get("ETHERSCAN_API_KEY_2", "")
        _api_keys = [k for k in [k1, k2] if k]
    if not _api_keys:
        return ""
    return _api_keys[_current_key_idx % len(_api_keys)]


def switch_api_key():
    """Switch to the next available API key."""
    global _current_key_idx
    if len(_api_keys) > 1:
        _current_key_idx += 1
        print(f"  🔄 Switched to API key #{(_current_key_idx % len(_api_keys)) + 1}")
        return True
    return False


def fetch_json(url, retries=3, delay=2):
    """Fetch JSON from URL with retry logic + API key fallback."""
    for attempt in range(retries):
        try:
            req = Request(url, headers={"User-Agent": "ZRO-Dashboard/1.0"})
            with urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode())
                # Check for Etherscan rate limit
                if isinstance(data, dict) and "rate limit" in str(data.get("result", "")).lower():
                    if switch_api_key():
                        new_key = get_api_key()
                        url = re.sub(r'apikey=[^&]+', f'apikey={new_key}', url)
                        continue
                return data
        except Exception as e:
            if attempt < retries - 1:
                print(f"  ⚠️ Attempt {attempt+1} failed: {e}")
                time.sleep(delay)
    return None
