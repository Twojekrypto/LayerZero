# ZRO Analytics Dashboard — Project State

> **Ostatnia aktualizacja:** 2026-03-20
> **Live:** https://twojekrypto.github.io/LayerZero/
> **Repo:** GitHub Pages (branch `master`)

---

## 🎯 Cel

Analytics dashboard dla **LayerZero (ZRO)** — holder tracking, fresh wallet detection, multi-chain flow analysis, vesting & allocation breakdowns.

## 🏗️ Architektura

```
ZRO/
├── index.html              ← Main dashboard (SPA)
├── app.js                  ← Dashboard logic (rendering, charts, tabs)
├── style.css               ← Styles
│
├── *.py                    ← Data pipeline scripts (Python)
├── zro_data.json           ← Main data file (holders, flows, meta)
├── holders_multichain.json ← Raw multi-chain holder data
├── scan_state.json         ← Incremental scan state (lastBlock per chain)
│
├── ZRO holders/            ← CSV snapshots per chain (fallback data)
│   ├── ethereum.csv
│   ├── Arbitrum ZRO.csv
│   ├── BASE.csv
│   ├── bsc.csv
│   ├── OPtymism.csv
│   ├── polygon.csv
│   └── AVAX.csv
│
├── .github/workflows/
│   ├── update-data.yml     ← Daily full scan (06:00 UTC)
│   └── refresh-balances.yml ← Hourly balance refresh (:15)
│
├── PROJECT_STATE.md        ← Ten plik
└── lessons.md              ← Wzorce błędów i reguły (CZYTAJ NA STARCIE!)
```

## 🐍 Data Pipeline (Python Scripts)

| Skrypt | Co robi | Źródło | Częstość |
|---|---|---|---|
| `fetch_holders.py` | Multi-chain holder discovery | Alchemy (primary) + Etherscan (fallback) + CSV | Daily |
| `update_data.py` | Merge holders z labels, walidacja danych | Lokalne JSON | Daily |
| `detect_fresh.py` | Detect walletów <30 dni | Etherscan (txlist + tokentx) | Daily |
| `generate_flows.py` | Real on-chain IN/OUT flows | Etherscan (multi-chain) | Daily |
| `refresh_balances.py` | Live balance top 500 + Token Unlocks watcher | Etherscan (tokenbalance) | Co godzinę |

## 🔗 Chain Coverage

| Chain | Primary API | Fallback | Status |
|---|---|---|---|
| Ethereum | Alchemy | Etherscan | ✅ |
| Arbitrum | Alchemy | Etherscan | ✅ |
| Base | Alchemy | CSV | ✅ |
| Optimism | Alchemy | CSV | ✅ |
| Polygon | Alchemy | Etherscan | ✅ |
| BSC | CSV | — | ⚠️ Brak API |
| Avalanche | CSV | — | ⚠️ Brak API |

## 📅 Scan Modes

| Tryb | Kiedy | Czas | Co robi |
|---|---|---|---|
| **Incremental** | Pon-Sob | ~3 min | Tylko nowe transfery od `lastBlock` |
| **Full Rescan** | Niedziela | ~30-50 min | Od bloku 0, koryguje wszystko |
| **Force Full** | `FORCE_FULL_SCAN=1` | ~30-50 min | Wymuszony full rescan |

## 🔑 Wymagane Secrets (GitHub)

| Secret | Użycie |
|---|---|
| `ETHERSCAN_API_KEY` | Etherscan V2 API (free tier) |
| `ALCHEMY_API_KEY` | Alchemy RPC (free tier) |

## 🚀 Deployment

- **Hosting:** GitHub Pages z branch `master`
- **CI/CD:** 2 GitHub Actions workflows (daily + hourly)
- **Push:** `git push origin master`
- **Local testing:** `python3 -m http.server` (bo `file://` blokuje `fetch()`)

## 🧪 Local Refresh Commands

- **Full refresh:** `npm run refresh:data`
- **Hourly-style refresh:** `npm run refresh:data:hourly`
- **Preview plan only:** `npm run refresh:data:plan`
- **Direct Python entrypoint:** `python3 refresh_dashboard_data.py --mode full`

Wrapper uruchamia lokalnie ten sam układ kroków co workflowy repo, a na końcu odpala weryfikację MemPalace i smoke testy dashboardu.

## ⚠️ Kluczowe Reguły

1. **Zawsze czytaj `lessons.md` na starcie sesji**
2. **Alchemy jest PRIMARY** — Etherscan `tokentx` z `contractaddress` limituje do 10K wyników
3. **CSV fallback** dla BSC/AVAX — ręcznie aktualizuj CSV co jakiś czas
4. **Data validation** — `update_data.py` blokuje zapis gdy >50% holderów zniknie
5. **Incremental scan** — `scan_state.json` śledzi `lastBlock` per chain
