# Lessons Learned — ZRO Dashboard

## API Limits & Data Sources

- **⚠️ Etherscan `tokentx` z `contractaddress` (bez `address`) limituje do 10K wyników.** Na ETH z 100K+ transferów pobiera tylko ~10% danych. Zawsze używaj Alchemy `getAssetTransfers` jako primary source.
- **Alchemy `maxCount` max = `0x3E8` (1000).** Ustawienie wyższej wartości (np. `0x7D0`) powoduje error i 0 transferów.
- **Alchemy nie obsługuje BSC i Avalanche** — zwraca `403 Forbidden`. Użyj CSV fallback dla tych chainów.
- **Etherscan free tier nie pokrywa Base, BSC, OP, AVAX** — zwraca: `Free API access is not supported for this chain`. Wymaga płatnego planu lub Alchemy/CSV fallback.
- **Etherscan V2 API rate limit: 5 req/s** — wszystkie skrypty mają `time.sleep(0.22-0.25)` między requestami.

## Workflow & CI/CD

- **Timeout: zawsze 2-3× expected runtime.** Pierwszy run z Alchemy na ETH trwał 55 min. Z timeout 30 min → cancelled. Teraz: 180 min.
- **Alchemy pagination na pełnej historii ETH = 3400+ stron.** Bez MAX_PAGES limit, workflow trwa godzinami. Cap: 2000 stron (2M transferów).
- **Workflow cancelled ≠ workflow failed.** Cancelled nie zapisuje żadnego stanu — trzeba uruchomić od nowa.
- **scan_state.json musi być w `git add` w workflow.** Bez tego incremental scan nie działa (brak lastBlock).
- **⚠️ ZAWSZE `git pull --rebase -X theirs`** dla auto-generowanych JSON-ów. Zwykły `--rebase` crashuje na merge conflict w dużych plikach (5M+ linii). `-X theirs` = dane z workflow zawsze wygrywają (są nowsze). Lekcja z Dolomite, kosztowała nas noc danych w ZRO.
- **`continue-on-error: true`** na krokach detect_fresh + generate_flows — jeśli się wywalą, holder data i tak się zapisze.

## Fresh Wallet Detection

- **`detect_fresh.py` skanuje TYLKO wallety które JUŻ SĄ w `zro_data.json`.** Jeśli wallet nie jest w danych, nie zostanie sprawdzony. Dlatego `fetch_holders.py` musi znaleźć nowe wallety NAJPIERW.
- **EOA bez ETH (tylko ZRO):** `detect_fresh.py` ma fallback z `txlist` na `tokentx` — złapie także wallety zasilone wyłącznie tokenami.
- **"Fresh" = pierwsza transakcja <30 dni, nie "kiedy dostał ZRO".** Stary wallet z 2022 który dopiero teraz kupił ZRO NIE jest fresh.

## Data Integrity

- **`update_data.py` walidacja:** Blokuje zapis gdy:
  - >50% holderów zniknie (prawdopodobny bug w pipeline)
  - Top holder ma 0 balance
  - >20% labelowanych walletów straciło labele
- **`FORCE_SAVE=1`** pomija walidację (emergency override)
- **Flow data była FAKE** (do 2026-03-20) — `random.uniform()` generował losowe wartości. Naprawione: `generate_flows.py` pobiera prawidłowe transfery z Etherscan.
- **Reorg risk przy incremental scan:** Praktycznie zerowe dla naszego use case. Hourly `refresh_balances.py` sprawdza live `tokenbalance` → naprawia błędy balansów w <1h. Niedzielny full rescan resetuje historię.

## Multi-Chain

- **3-tier fallback per chain:** Alchemy → Etherscan → CSV. Kolejność ma znaczenie — Alchemy first bo ma pełną paginację.
- **CSV fallback to dane statyczne** — nie odświeżają się automatycznie. BSC/AVAX CSV trzeba ręcznie zaktualizować co jakiś czas ze strony Etherscan/BscScan.
- **Chain holder counts w `zro_data.json`** aktualizują się z `chain_stats` z `fetch_holders.py`. Jeśli chain zwrócił 0 transferów → 0 holderów.

## Dashboard

- **GH Pages cache:** Dodaj `?v=timestamp` do URL przy weryfikacji deploymentu.
- **Local testing:** `python3 -m http.server` — `file://` protokół blokuje `fetch()`.
- **Data freshness indicator:** 🟢 (<2h) / 🟡 (>2h) w footer, auto-refresh co 30s.

## General Patterns

- **Pierwszy run po zmianach zawsze odpów ręcznie** (`gh workflow run`) i sprawdź logi. Nie czekaj na cron.
- **Zawsze sprawdź `headSha` workflow** — jeśli pushowałeś fix i odpaliłeś workflow, sprawdź czy workflow użył nowego SHA. Jeśli nie, anuluj i odpal ponownie.
- **Nie ruszaj tego co nie jest konieczne** — minimalna zmiana, minimal impact.
- **⚠️ NIGDY bare `except: pass`** — silent exception swallowing ukrywa prawdziwe błędy. Zawsze loguj exception. W Dolomite to spowodowało brak 170+ pozycji E-Mode.
- **Cache API results agresywnie** — wyniki które się nie zmienią (wallet age, contract creation date) cachuj na dysk. Eliminuje 95%+ API calls. Pattern: `fresh_cache.json` z result + timestamp.
- **⚠️ Fallback data ukrywa real sell-offy** — jeśli API zwraca balance=0, NIE nadpisuj cachem. 0 może oznaczać "sprzedał wszystko" a nie "API failed". Rozróżniaj: network error vs legitimate zero.

## CSS & HTML (from Dolomite)

- **Po usunięciu HTML elementu → grep ALL JS references.** `getElementById('X')` na nieistniejącym elemencie = null crash który cicho łamie downstream.
- **Check `!important` overrides PRZED zmianą CSS.** `getComputedStyle()` w browser console > ufanie inline styles.
- **Po zmianie kolumn tabeli → audyt WSZYSTKICH `nth-child` selektorów.** CSS selektory cicho nadpisują inline styles.
- **Wait 30-60s na GH Pages deploy.** Nie zakładaj że zmiany są live od razu po push.
