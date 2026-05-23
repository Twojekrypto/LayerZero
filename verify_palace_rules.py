import json
import os
import re
import sys

# MemPalace: Contradiction Detection Script
# Sprawdza czy nasze lokalne bazy danych nie naruszają zakodowanej wiedzy w mózgu .mempalace-brain.yaml

DIR = os.path.dirname(os.path.abspath(__file__))
MEM_PALACE_FILE = os.path.join(DIR, ".mempalace-brain.yaml")
ZRO_DATA_FILE = os.path.join(DIR, "zro_data.json")

def get_yaml_value(content, key_path):
    """Prosty parser YAML do wyciągnięcia konkretnych adresów"""
    lines = content.split("\n")
    for line in lines:
        if key_path in line:
            match = re.search(r'["\'](0x[a-fA-F0-9]{40})["\']', line)
            if match:
                return match.group(1).lower()
    return None

def verify_palace_rules():
    print("🏰 MemPalace: Inicjalizacja skanera sprzeczności dla ZRO Dashboard...")
    
    if not os.path.exists(MEM_PALACE_FILE):
        in_ci = os.environ.get("CI", "").lower() == "true" or os.environ.get("GITHUB_ACTIONS", "").lower() == "true"
        if in_ci:
            print(f"⚠️ MemPalace skipped in CI: optional brain file missing at {MEM_PALACE_FILE}")
        else:
            print(f"⚠️ Pomijam MemPalace verification - brak pliku mózgu {MEM_PALACE_FILE}")
        return 0

    with open(MEM_PALACE_FILE, "r") as f:
        brain_data = f.read()

    # Wyciągnij kluczowe adresy z mózgu MemPalace
    zro_token = get_yaml_value(brain_data, "zro_token:")
    okx_wallet = get_yaml_value(brain_data, "okx:")
    robinhood_wallet = get_yaml_value(brain_data, "robinhood:")
    
    cex_wallets = {
        okx_wallet: "OKX",
        robinhood_wallet: "Robinhood"
    }

    print(f"✅ Wczytano logikę z MemPalace: ZRO Token={zro_token[:6]}..., Zdefiniowane CEX={len([w for w in cex_wallets if w])}")

    if not os.path.exists(ZRO_DATA_FILE):
        print(f"⚠️ Pomijam weryfikację pliku zro_data.json - brak pliku")
        return

    with open(ZRO_DATA_FILE, "r") as f:
        try:
            zro_data = json.load(f)
        except json.JSONDecodeError:
            print(f"❌ BLĄD: Nie można sparsować {ZRO_DATA_FILE}")
            return 1

    contradictions_found = 0
    print("🛡️ Skanowanie sprzeczności (Contradiction Detection)...")

    # RULE: CEX wallets must retain their labels and cannot be blank or incorrectly typed if they exist in holders
    top_holders = zro_data.get("top_holders", [])
    for holder in top_holders:
        addr = holder.get("address", "").lower()
        if addr in cex_wallets and addr:
            expected_name = cex_wallets[addr]
            actual_label = holder.get("label")
            if not actual_label or expected_name.lower() not in actual_label.lower():
                print(f"❌ [CONFLICT ALERT]: Portfel {expected_name} ({addr}) utracił swoją asygnowaną etykietę! Aktualna etykieta: '{actual_label}'")
                contradictions_found += 1

    if contradictions_found == 0:
        print("✅ Pomyślnie zweryfikowano: Żadne reguły biznesowe MemPalace nie wykluczają się z plikami bazy danych ZRO.")
        return 0
    else:
        print(f"🔥 Wykryto {contradictions_found} sprzeczności! Należy poprawić etykiety.")
        return 1

if __name__ == "__main__":
    sys.exit(verify_palace_rules())
