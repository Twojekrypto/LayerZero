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
- **⚠️ NIGDY nie dodawaj state files do .gitignore** (`cb_monitor_state.json` etc.) jeśli GitHub Actions ich potrzebuje między runami. Gitignored = każdy run zaczyna od zera.
- **`actions/cache` key musi być stabilny.** `hashFiles('script.py')` invaliduje cache przy każdej edycji kodu. Używaj stałego klucza (np. `flow-cache-v1`).
- **Nie auto-labeluj bez weryfikacji.** Wallet z Token Unlocks nie jest automatycznie "Fresh" — może to być stary portfel. Labeling powinien przechodzić przez `detect_fresh.py`.
- **Aging labels musi być OSOBNYM passem.** Jeśli aging code jest wewnątrz pętli "candidates" (walletów bez label), to labeled wallety są pomijane → nigdy nie expire.

## Fresh Wallet Detection

- **`detect_fresh.py` skanuje TYLKO wallety które JUŻ SĄ w `zro_data.json`.** Jeśli wallet nie jest w danych, nie zostanie sprawdzony. Dlatego `fetch_holders.py` musi znaleźć nowe wallety NAJPIERW.
- **EOA bez ETH (tylko ZRO):** `detect_fresh.py` ma fallback z `txlist` na `tokentx` — złapie także wallety zasilone wyłącznie tokenami.
- **"Fresh" = pierwsza transakcja <30 dni, nie "kiedy dostał ZRO".** Stary wallet z 2022 który dopiero teraz kupił ZRO NIE jest fresh.
- **Multichain Consistency:** Skrypty takie jak `monitor_whale_transfers.py` MUszą weryfikować wiek portfela przez pobieranie historii ze wszystkich chainów, tak jak robi to główny skan `detect_fresh.py`. Weryfikacja tylko `chainid=1` doprowadzi do fałszywych alarmów, z tytułu starych wielorybów na warstwie L2 przerzucających swoje pierwsze środki na ETH.
- **Nie mieszaj freshness z zachowaniem na CEX.** Wiek walleta odpowiada na pytanie „czy jest nowy”, a profil CEX odpowiada na pytanie „jak się zachowuje”. `CEX -> wallet` nie powinno samo z siebie dyskwalifikować `Fresh Wallet`, a `wallet -> CEX` powinno raczej budować profil ryzyka niż od razu usuwać label.

## Data Integrity

- **`update_data.py` walidacja:** Blokuje zapis gdy:
  - >50% holderów zniknie (prawdopodobny bug w pipeline)
  - Top holder ma 0 balance
  - >20% labelowanych walletów straciło labele
- **`FORCE_SAVE=1`** pomija walidację (emergency override)
- **Flow data była FAKE** (do 2026-03-20) — `random.uniform()` generował losowe wartości. Naprawione: `generate_flows.py` pobiera prawidłowe transfery z Etherscan.
- **Reorg risk przy incremental scan:** Praktycznie zerowe dla naszego use case. Hourly `refresh_balances.py` sprawdza live `tokenbalance` → naprawia błędy balansów w <1h. Niedzielny full rescan resetuje historię.
- **Manual Data Overrides vs Pipelines:**  ❌ Nigdy nie wprowadzaj ręcznych zmian (np. labeli) bezpośrednio `zro_data.json`, jeśli ten plik jest regularnie przepisywany przez GitHub Actions. Pipeline podczas `git pull --rebase -X theirs` nadpisze i zniszczy manualne poprawki. Zamiast tego zaimplementuj systemowe obejścia wewnątrz samych skryptów (np. wymuszanie labeli poprzez słowniki sprawdzające pod koniec procesu pipeline'owego).

## Multi-Chain

- **3-tier fallback per chain:** Alchemy → Etherscan → CSV. Kolejność ma znaczenie — Alchemy first bo ma pełną paginację.
- **CSV fallback to dane statyczne** — nie odświeżają się automatycznie. BSC/AVAX CSV trzeba ręcznie zaktualizować co jakiś czas ze strony Etherscan/BscScan.
- **Chain holder counts w `zro_data.json`** aktualizują się z `chain_stats` z `fetch_holders.py`. Jeśli chain zwrócił 0 transferów → 0 holderów.

## Dashboard

- **GH Pages cache:** Dodaj `?v=timestamp` do URL przy weryfikacji deploymentu.
- **Local testing:** `python3 -m http.server` — `file://` protokół blokuje `fetch()`.
- **Data freshness indicator:** 🟢 (<2h) / 🟡 (>2h) w footer, auto-refresh co 30s.

## General Patterns

- **Wallet Labels are stored in multiple places:** For the UI, update `KNOWN_CEX_LABELS` in `app.js`. For the python scripts, update `KNOWN_CEX_ADDRESSES` in `auto_label.py`. And to permanently attach it to holder data, update `top_holders` in `zro_data.json` with `.label` and `.type`.
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

## Dashboard Consistency & Data Quality (2026-04-16)

- **Po każdej większej aktualizacji dopisz krótki wpis do `lessons.md`.** Minimum: co zmieniono, co się wysypało, co trzeba pamiętać przy następnym runie.
- **Historyczny snapshot NIE może używać `Date.now()` do filtrów typu last 7d / 30d / 90d.** Wszystkie relative ages i okresy muszą być liczone względem `meta.generated`, inaczej UI pokazuje fałszywe wyniki dla starego `zro_data.json`.
- **`top_holders` trzeba normalizować po pipeline.** Deduplikacja po adresie, zachowanie bogatszych metadanych i cleanup zero-balance holderów powinny być osobnym krokiem końcowym, a nie tylko efektem ubocznym pojedynczych skryptów.
- **Nie zakładaj, że `chains.*.supply` zawsze zgadza się z indeksowanymi balance holderów.** Jeśli tracked balances > configured supply na chainie, dashboard ma to pokazać jako ostrzeżenie zamiast udawać precyzyjny supply breakdown.
- **Sekcja `Fresh Wallets` potrzebuje backfillu metadanych po samym detection.** Sam label `FRESH` nie wystarczy — bez `wallet_created` i `last_flow` sortowanie i age labels robią się mylące albo puste.
- **Smoke testy powinny pilnować integralności danych, nie tylko istnienia kluczy.** Minimum: brak duplikatów adresów w `top_holders`, obecność `meta.integrity`, i sprawdzenie, że frontend kotwiczy czas do snapshotu.
- **Jeśli nie jesteśmy pewni poprawnej wartości źródłowej, nie „naprawiaj” danych ręcznie na chybił-trafił.** Lepiej zapisać anomalię w `meta.integrity`, pokazać ją w UI i poprawić generator źródła przy następnym refreshu.

## Fresh Wallet Sticky Labels (2026-04-17)

- **Po każdej większej zmianie dopisuj wnioski do `lessons.md`.** To ma być stały log decyzji pipeline + UI, nie jednorazowa notatka.
- **`Fresh Wallet` musi być sticky label, nie chwilową heurystyką.** Jeśli portfel dostał status `Fresh Wallet`, pipeline ma już zawsze zachować `label = "Fresh Wallet"` i `type = "FRESH"`, zamiast później agingować go albo relabelować do Coinbase Prime.
- **Sticky Fresh trzeba wymusić w kilku miejscach naraz:** `update_data.py` przy merge holderów, `detect_fresh.py` przy cache/aging i Coinbase pass, `monitor_whale_transfers.py` przy auto-dodawaniu nowych portfeli, oraz `sanitize_zro_data.py` przy końcowej normalizacji snapshotu.
- **`label_manual = true` jest naszym lockiem na Fresh Wallet.** Jeśli wallet jest `FRESH`, to podczas merge i cleanupu trzeba zachować też `fresh = true` oraz `label_manual = true`, inaczej kolejny refresh może ten status zgubić.
- **Normalizacja końcowa ma naprawiać także bieżący snapshot, nie tylko przyszłe runy.** Po zmianie logiki zawsze odpal `sanitize_zro_data.py`, żeby istniejące rekordy dostały nowy, spójny stan bez czekania na następny full refresh.
- **Heurystyki `Fresh Wallet` i backfill muszą używać tej samej współdzielonej logiki multi-chain.** Jeśli `detect_fresh.py`, `backfill_fresh.py` i `monitor_whale_transfers.py` mają własne kopie funkcji, bardzo szybko rozjadą się między sobą.
- **Anty-CEX ma sens jako filtr jakości, ale tylko jeśli działa multi-chain.** Ethereum-only check przepuszcza L2-only proxy/deposit wallety i daje fałszywe `Fresh Wallet`.
- **Bug z `NEW_INST` może ukryć nowe instytucjonalne kontrakty.** Jeśli helper zwraca deployera bez timestampu deployu, późniejsza logika nie potrafi już odróżnić „new institutional” od „old institutional”.
- **Samo `>= 2 interakcje z CEX` jest zbyt toporne jako filtr fresh.** Dwa inboundy z giełdy mogą oznaczać zwykłe kupowanie. Lepiej ważyć dużo mocniej `wallet -> CEX` niż `CEX -> wallet`, i rozróżniać „mały testowy ruch” od „realnego depozytu na giełdę”.
- **Lista adresów CEX powinna mieć jeden backend source of truth.** Jeśli `auto_label.py`, `detect_fresh.py`, `monitor_whale_transfers.py` i `monitor_cb_prime.py` trzymają własne kopie mapy, to po kilku zmianach zaczynają filtrować różne rzeczy.
- **Nowy model anty-CEX dla fresh:** `CEX -> wallet` buduje profil `cex_funded` / `cex_accumulator`, pojedyncze lub lekkie `wallet -> CEX` daje tylko `mixed_cex_activity`, a twarde odrzucenie zostaje dopiero dla `cex_recycler` przy ciężkim recyclingu (`>=20` outboundów do CEX na ETH+Arbitrum).
- **Badge w UI powinien pokazywać ludzki profil, nie surowy reason key.** Jeśli frontend pokaże `cex_funded` albo `heavy_cex_recycling`, to szybko robi się nieczytelny; użytkownik powinien widzieć `CEX funded`, `Active CEX user` itp. z prostym tooltipem.
- **Jeśli celem są duże nowe portfele akumulujące ZRO, sama etykieta `Fresh Wallet` to za mało.** Potrzebny jest drugi wymiar sygnału oparty o `current balance + retention ratio + net accumulation`, żeby odróżnić zwykły nowy wallet od realnego akumulatora.
- **Najbardziej użyteczny scoring dla fresh to nie liczba tx, tylko jakość zatrzymania kapitału.** `retention_ratio = current_balance / total_inbound_zro` oraz `net_accumulation = inbound - outbound` lepiej łapią conviction niż same liczniki transferów.
- **Warto mieć trzy poziomy priorytetu dla świeżych portfeli:** `Accumulator watchlist`, `Accumulator`, `Whale accumulator`. Dzięki temu dashboard może pokazywać nie tylko „kto jest nowy”, ale też „kto wygląda na duży, świeży portfel, który realnie buduje pozycję”.
- **Jeśli celem dashboardu jest discovery, domyślne sortowanie `Fresh Wallets` nie powinno być po samym balance.** Lepszy default to `fresh_signal_score`, a dopiero potem tie-break na `net accumulation`, `retention` i `balance`, bo wtedy najwyżej lądują portfele najbardziej warte uwagi, a nie po prostu największe.
- **Po backfillu fresh walletów zawsze odpal `sanitize_zro_data.py`.** Sam `backfill_fresh.py` może naprawić rekordy w `top_holders`, ale frontend bazuje też na `meta.integrity`; bez ponownej normalizacji dashboard może dalej pokazywać stare liczby braków.
- **Tabela `Fresh Wallets` powinna mieć miękki fallback dla `Created`.** Jeśli z jakiegoś powodu `wallet_created` znów zniknie, lepiej pokazać `First seen` albo `Tracked on snapshot` jako estimate niż pustą kolumnę, która wygląda jak awaria.
- **Po dodaniu nowych badge'y do `Fresh Wallets` trzeba pozwolić adresowej komórce się zawijać.** Sztywne `white-space: nowrap` szybko robi chaos przy `FRESH + Signal + Profile + funded_by`, zwłaszcza na mniejszych szerokościach.
- **Sekcja `Fresh Wallets` zasługuje na własny `colgroup`.** Gdy dokładamy kolumnę `Signal`, trzeba od razu poprawić szerokości kolumn, inaczej fixed-layout ściska najważniejsze treści i tabela wygląda na przypadkową.
- **Sam ranking nie wystarczy do discovery; potrzebny jest też szybki filtr.** Dla `Fresh Wallets` najlepiej działa prosty przełącznik `All / Accumulators / Whale only`, spięty z URL state, żeby dało się jednym kliknięciem przejść od szerokiego skanu do portfeli najwyższej jakości.
- **Jeśli chcesz widzieć `Whale accumulator` bez przełączania widoku, dodaj osobny stat nad tabelą.** To powinien być licznik z całego fresh universe, a nie tylko z aktualnie przefiltrowanej listy, bo inaczej przestaje pełnić rolę szybkiego discovery cue.
- **Dobry discovery stat powinien umieć zrobić drill-down jednym kliknięciem.** Jeśli licznik `Whale Accumulators` jest widoczny nad tabelą, warto dać mu `click-through` do filtra `Whale only`, razem z `aria-pressed`, focus ringiem i aktywnym stanem, żeby działał jak prawdziwa kontrolka, a nie martwa metryka.
- **Premium dashboard nie potrzebuje większej liczby widgetów, tylko lepszego shellu i spokojniejszej hierarchii.** Największy skok jakości daje zwykle: mocniejszy header z utility KPI, bardziej szlachetne surface’y kart oraz tabele z wyraźnym sticky headerem, równym spacingiem i subtelnym hoverem zamiast dokładania kolejnych boxów.
- **Jeśli tabela ma wyglądać premium, musi mieć własny charakter sekcyjny.** Sam globalny hover nie wystarczy; najlepiej działają delikatne akcenty per tabela lub per row type, np. inne left-rail highlighty dla `Fresh`, `Coinbase`, `Accumulators`, `Sellers` i `Whale Transfers`, plus scroll-edge fades i spokojniejsza paginacja.
- **Premium mobile tables nie powinny kończyć się na poziomym scrollu.** Dla najważniejszych discovery tabel lepiej działa tryb `card rows` z `data-label`, gdzie każdy wiersz zamienia się na małą kartę z nazwami pól, a desktop zachowuje klasyczną tabelę.
- **Po dopracowaniu UX tabel warto zrobić realny browser pass, nie tylko smoke test.** Screenshoty mobile szybko wyłapują rzeczy, których testy logiczne nie zobaczą, np. nachodzące na siebie KPI, zbyt ciasne filtry albo puste miejsca w gridzie statów.
- **`ZRO Hodlers` na mobile potrzebuje innego modelu czytania niż desktop.** Przy dużej liczbie chain columns lepiej pokazywać tylko niezerowe balance jako pola karty, zamiast próbować zmieścić pełną desktopową tabelę na wąskim ekranie.
- **Drawer sprawdza się jako drugi poziom gęstości informacji.** Jeśli wiersz ma być szybki do skanowania, ale nadal potrzebujemy więcej kontekstu dla touch UX, lepiej otworzyć lekki detail drawer niż dokładać kolejne badge’e i mikroteksty do samej tabeli.
- **Tokenomics tabele też trzeba traktować jak first-class mobile UI.** Nawet jeśli desktopowo wyglądają dobrze, gęste tabele typu `Funding Rounds` bardzo szybko zaczynają się nakładać na mobile; najlepszym fixem jest ten sam card-row pattern z `data-label`, zamiast ściskania kolumn do granic czytelności.
- **Premium polish najlepiej działa tam, gdzie uspokajamy powierzchnie zamiast dokładania ozdobników.** W `Tokenomics` mocniejszy efekt dały spokojniejsze gradienty, czystsza typografia i lepszy rytm kart niż dokładanie nowych ramek czy dodatkowych wskaźników.
- **Premium motion w drawerze powinien być prawie niewidoczny.** Subtelne `opacity + scale + rise` daje wrażenie jakości i lekkości; cięższe animacje szybko robią się męczące przy częstym otwieraniu szczegółów z tabel.
- **`Flows` muszą rozróżniać net recipient od prawdziwego accumulatora.** Sam dodatni `net_flow` nie wystarczy, bo wtedy cold wallet giełdy albo routingowy adres protokołu zaczynają wyglądać jak akumulatorzy. Dla sensownego rankingu trzeba odfiltrować infrastrukturę, cache-only rows i sprawdzać choć minimalny retention / balance ratio.
- **Chain filter w flowach musi opierać się na chain context transferu, nie na dzisiejszym balance holdera.** Jeśli przy transferze nie zapisujemy `chain`, UI zaczyna filtrować po obecnym rozkładzie balansów, a nie po miejscu, gdzie flow faktycznie zaszedł.
- **Jeśli chain transferu nie da się ustalić pewnie, flow row powinien być oznaczony jako `chain_unresolved`, a nie zgadywany po bieżących balansach.** Dla widoku `All Chains` taki rekord może zostać, ale przy filtrowaniu po sieci lepiej go wyciąć niż pokazać pod potencjalnie złą siecią.
- **`Accumulator` nie powinien opierać się tylko na obecnym balance.** Sam dodatni `net_flow` plus duży historyczny balance potrafi fałszywie wyglądać jak akumulacja; lepszy filtr to połączenie `retention`, `net_flow / total_in` i minimalnego `net_flow / balance`.
- **`Seller` potrzebuje własnego progu jakości, inaczej outflow łapie mikro-szum.** Jeśli wystarczy samo `net_flow < 0`, w tabeli lądują ruchy typu `-1`, `-22` czy `-100 ZRO`, które zaśmiecają discovery i nie są realnym sygnałem dystrybucji.
- **Flow discovery staje się dużo bardziej użyteczny, gdy oprócz kierunku pokażemy też cohort i profil outflow.** Sam `accumulator/seller` to za mało; rozdzielenie na `Organic / Strategic / Coinbase` oraz seller profile typu `CEX outflow`, `Strategic rotation`, `Mixed outflow` czy `Holder redistribution` daje dużo lepszy wgląd w naturę ruchu.
- **`flow_score` powinien porządkować discovery lepiej niż surowy `net_flow`.** Dla accumulatorów warto ważyć `retention`, `net_flow / total_in` i `net_flow / balance`, a dla sellerów dodatkowo wzmacniać prawdopodobny sell pressure do CEX.
- **Jeśli część flow rows ma `chain_unresolved`, trzeba to pokazać w UI.** Uczciwy badge/note typu `N unresolved rows hidden from chain filter` jest lepszy niż ciche znikanie wyników albo zgadywanie sieci po bieżących balansach.
- **Flow toolbar potrzebuje osobnego filtra cohort, nie tylko chain + search.** W praktyce `All / Organic / Strategic / Coinbase` daje dużo większą wartość analityczną niż sama zmiana sortowania, bo użytkownik może od razu przełączyć narrację sekcji bez ręcznego filtrowania wzrokiem.
- **Nowy rebuild `flow_cache.json` najlepiej robić już na aktualnym daily snapshotcie z `origin/master`, nie na starszym lokalnym pliku.** Wtedy flow cache i holder universe są zsynchronizowane, a incremental run może od razu doskanować tylko nowe bloki plus nowe wejścia do top holderów.
- **Incremental rebuild cache potrafi domknąć także nowe wallety, nie tylko nowe bloki.** Jeśli wallet pojawia się w top holder universe, generator robi mu pełny backfill historyczny nawet w trybie przyrostowym, więc jakość discovery poprawia się bez kolejnego pełnego rocznego skanu.
- **Free Etherscan nadal ogranicza pełny multi-chain rebuild, ale dla flow quality najwięcej daje świeży ETH/ARB cache.** To właśnie tam pojawia się główny sygnał, a mniej istotne chainy można traktować jako best-effort dopóki nie przejdziemy na wyższy plan API.
- **`Accumulator` bez źródła inflow to tylko połowa historii.** Dużo lepiej działa rozbicie na `Coinbase funded`, `CEX funded`, `Holder-built`, `Strategic inflow`, `External inflow` i `Mixed inflow`, bo od razu widać skąd faktycznie budowana była pozycja.
- **`Fresh + Flow` warto scalać bezpośrednio w flow rows, a nie tylko w osobnej tabeli `Fresh Wallets`.** Badge typu `Fresh whale`, `Fresh accumulator` albo `Fresh seller` daje od razu discovery signal w kontekście realnego net flow i pomaga szybciej wyłapać nowe duże portfele.
- **`Seller` i `sell pressure` to nie to samo.** Sam ujemny `net_flow` powinien dalej klasyfikować sellera, ale do rankingu i discovery lepszy jest osobny `sell_pressure_score`, który mocniej waży outflow do CEX/Coinbase oraz udział outflow względem aktualnego balance.
- **Ręcznie wpisane `chains.supply` szybko się starzeje i potem psuje wiarygodność dashboardu.** Jeśli holder snapshot jest źródłem prawdy dla warstwy distribution, to `chains.supply` trzeba synchronizować z bieżącym indexed holder universe przy każdym merge, zamiast zostawiać stare “verified” liczby z innego dnia.
- **Najbezpieczniejszy model to rozdzielić kanoniczne `total_supply` od snapshotowego `per-chain supply`.** Globalne procenty w UI mogą dalej liczyć się od `1B`, ale per-chain supply dla distribution powinno pochodzić z aktualnego indexed snapshotu i mieć własny `supply_source` / `supply_synced_at`.
- **`Whale Transfers` też potrzebują sanitizacji historii, nie tylko świeżego skanu.** Samo pomijanie `CEX→CEX` w monitorze nie wystarczy, jeśli stare snapshoty już zawierają takie rekordy; sanitizer powinien je czyścić i deduplikować przed renderem.
- **Znane adresy CEX muszą mieć bezwzględny priorytet w labelowaniu UI.** Jeśli mapa z `top_holders` może nadpisać Coinbase/Binance/OKX etykietą `Whale` albo `Fresh Wallet`, sekcja whale szybko staje się myląca mimo poprawnych surowych danych.
- **`Whale Transfers` najlepiej działa jako feed z lekkim discovery layer, nie jako goła lista txów.** Filtr `All / Buys / Sells / Moves`, kontekstowy badge odbiorcy i prosty `whale score` dają dużo lepszą czytelność bez zmiany samego modelu danych.
- **Przy gęstych tabelach produktowych najwięcej daje summary rail i lepsze “row meaning”, nie dokładanie kolejnych kolumn.** Jeśli nad tabelą masz krótki strip z najważniejszym bilansem, a w wierszu widać `signal`, `context` i `intensity`, to sekcja zaczyna działać jak narzędzie, a nie dump danych.
- **Breakpoint dla rozbudowanych tabel discovery musi wejść wcześniej niż przy prostych tabelach.** Gdy `Flows` i `Whale Transfers` dostają badge’e, meta copy i dodatkowe linie kontekstu, zbyt późne przejście do układu jednokolumnowego kończy się ściskaniem tabeli; lepiej wcześniej złożyć `flow-grid` do jednego słupka i wymusić kontrolowany overflow niż pozwolić layoutowi się rozjechać.
- **W `Flows` lepiej działa układ 3-kolumnowy niż klasyczna tabela `Address / Net Flow / Balance`.** Jeśli balance przeniesiemy do komórki walleta, a prawa kolumna zostanie zarezerwowana tylko dla sygnału i kontekstu, sekcja zaczyna wyglądać jak czytelny compare board zamiast pół-surowego arkusza danych.
- **Jeśli tabela discovery zaczyna wymagać poziomego scrolla, zwykle problemem jest ilość treści w komórce, nie sam grid.** W `Flows` najlepiej zadziałało wycięcie drugorzędnych badge’y i metryk z wiersza oraz zostawienie tylko: kto to jest, ile trzyma i jaki ma sygnał. Reszta może żyć w drawerze szczegółów.
