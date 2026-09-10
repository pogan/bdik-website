# Komendy, skrypty, flagi i zmienne środowiskowe

Kompletna lista wszystkiego, co da się uruchomić w tym repozytorium: skrypty
npm, skrypty operacyjne (`scripts/`), pipeline ETL, testy, uruchomienie serwera,
PM2, Stripe CLI oraz endpointy HTTP przydatne operatorowi.

Wszystkie skrypty czytają konfigurację z `.env` (przez `dotenv`). Ścieżkę do
bazy nadpisuje `DB_PATH` — używaj go zawsze, gdy chcesz testować na kopii, żeby
nie pisać do produkcyjnego `data/bdik.sqlite`.

---

## 1. Skrypty npm (`package.json`)

| Komenda | Co robi |
|---|---|
| `npm start` | Uruchamia serwer produkcyjnie: `node app.js`. Port z `PORT` (domyślnie 3000). |
| `npm run dev` | Serwer w trybie deweloperskim z auto-restartem: `node --watch app.js`. |
| `npm run etl` | Pełny przebieg ETL: `node etl/run.js` — ładuje i deduplikuje instytucje do `data/bdik.sqlite`. Zob. sekcję 3. |
| `npm run enrich` | Agent uzupełniania danych kontaktowych: `node scripts/enrich_contacts.js`. Zob. sekcję 4. |
| `npm run vendor` | Kopiuje zasoby front-endu (Bootstrap, ikony, font Inter) z `node_modules` do `public/vendor/`. Uruchom po zmianie wersji tych paczek. Wynik commitowany do repo. |
| `npm run og-image` | Buduje statyczny obraz Open Graph `public/images/og-cover.png` (1200×630). Napis z domeną bierze z `PUBLIC_BASE_URL` — uruchom z produkcyjnym env przed publikacją, inaczej pokaże „localhost". |
| `npm test` | `node scripts/test-db.js && DB_PATH=data/test.sqlite node --test` — tworzy kopię bazy i uruchamia cały zestaw testów na kopii. Zob. sekcję 5. |

---

## 2. Uruchomienie serwera

| Komenda | Uwagi |
|---|---|
| `node app.js` | Bezpośrednio. |
| `node --watch app.js` | Z auto-restartem (to samo co `npm run dev`). |
| `PORT=3457 DB_PATH=/tmp/x.sqlite SESSION_SECRET=verify node app.js` | Typowy zestaw do lokalnej weryfikacji na kopii bazy. |
| `curl -s localhost:3000/healthz` | Health check → `{"status":"ok"}`. |

`/` zwraca **301 na `/baza`** — do testów curl-uj `/baza`.

---

## 3. ETL — `node etl/run.js` (`npm run etl`)

Skrypt **nie przyjmuje argumentów CLI**; steruje się nim zmiennymi środowiskowymi.

| Zmienna | Efekt |
|---|---|
| `NODE_ENV=production` | Do bazy trafiają **tylko realne źródła**: `seed` (CSV) oraz `rik` jeśli `RIK_LIVE=true`. Źródła-mocki (`ceidg`, `krs`, `gus`, `rik` bez `RIK_LIVE`) są pomijane z komunikatem w logu. |
| `NODE_ENV` inne / brak | Uruchamiane są **wszystkie** źródła, łącznie z mockami (fixture'y) — jedyny sposób, żeby przećwiczyć ścieżkę scalania wielu źródeł. |
| `RIK_LIVE=true` | Źródło `rik` czyta żywe API Otwartych Danych MKiDN zamiast fixture'a. Działa też na produkcji. |
| `DB_PATH` | Docelowa baza SQLite (domyślnie `./data/bdik.sqlite`). |

Kolejność źródeł: `seed → ceidg → krs → rik → gus`. Priorytet przy konflikcie
pól: **GUS > RIK > KRS > CEIDG > seed** (`etl/dedup.js`). Klucz deduplikacji:
REGON, a gdy go brak — `nazwa_znormalizowana + kod_pocztowy + numer_domu`.
Bez REGON-u nowego wiersza nie da się założyć (kolumna `NOT NULL UNIQUE`) —
takie rekordy mogą tylko wzbogacać dopasowane instytucje.

Plik źródłowy seeda: `kk_claude_data/initial_database_100920206.csv`
(`sources/csv_seed.js`). Katalog `kk_claude_data/` jest w `.gitignore` —
plik trzymany lokalnie i na serwerze.

Przykłady:

```bash
# Bezpieczny test na kopii (wszystkie źródła + mocki)
cp data/bdik.sqlite /tmp/etl-test.sqlite
DB_PATH=/tmp/etl-test.sqlite npm run etl

# Produkcyjny przebieg (tylko seed) — na serwerze
NODE_ENV=production npm run etl

# Produkcja + żywe RIK
NODE_ENV=production RIK_LIVE=true npm run etl
```

---

## 4. Skrypty operacyjne (`scripts/`)

### `scripts/add_user.js` — allowlista logowania

```bash
node scripts/add_user.js <email> [rola]
```

Dodaje adres do allowlisty logowania Google (tabela `users`) albo aktywuje
istniejący. `rola` domyślnie `viewer`; `admin` daje dostęp do `/admin/*`.
Konto istnieje wyłącznie w bazie — nie ma samodzielnej rejestracji.

### `scripts/optout_institution.js` — usunięcie instytucji (RODO)

```bash
node scripts/optout_institution.js <REGON> [powód]
```

Realizacja żądania usunięcia (RODO art. 17/21). REGON musi mieć 9 albo 14 cyfr.
Dodaje REGON do `institution_optouts` (żeby kolejny ETL go nie przywrócił)
i usuwa rekord z `institutions`. Zapytania i eksport i tak pomijają REGON-y
z listy opt-out.

### `scripts/remove_test_fixtures.js` — czyszczenie rekordów testowych

```bash
node scripts/remove_test_fixtures.js
```

Jednorazowe usunięcie rekordów testowych/dev, które trafiły do bazy (nazwy
`TEST%`, powiat `PRZYKŁADOWY`/`WZORCOWY`, REGON z puli `100000%`). Bez
argumentów. Zalecane: najpierw `DB_PATH=data/test.sqlite`, zweryfikuj, potem
bez `DB_PATH`.

### `scripts/build_sample_export.js` — próbka eksportu (PDF)

```bash
node scripts/build_sample_export.js
```

Generuje `public/pliki/przykladowa-lista-instytucji-kultury.pdf` (po jednej
kompletnej instytucji z każdego województwa) tym samym kodem co eksport płatny.
Uruchom **po każdej aktualizacji bazy** oraz **po zmianie `SELLER_*` w `.env`**
(nota licencyjna z nazwą sprzedawcy jest wpiekana w plik przy generowaniu).

### `scripts/enrich_contacts.js` — agent uzupełniania kontaktów (`npm run enrich`)

```bash
node scripts/enrich_contacts.js [flagi]
```

Wielofazowy pipeline uzupełniania WWW / telefonu / e-maila:
1. Weryfikacja istniejących adresów WWW (naprawa przez obcinanie podstron/subdomen).
2. Wyprowadzenie WWW z domeny e-maila (jeśli własna, nie gmail/wp).
3. Scrape strony instytucji i podstron „kontakt" (odszyfrowuje Cloudflare i `[at]`;
   nieodczytywalne → kolejka `data/enrich_review.json`).
4. Wyszukiwarka (DuckDuckGo) dla wciąż niekompletnych — z dziennikiem prób
   (`web_enrich_attempts`), więc po blokadzie kolejne uruchomienie wznawia.

Raport: `data/enrich_report.json`. Do ręcznego przepisania: `data/enrich_review.json`.

| Flaga | Domyślnie | Znaczenie |
|---|---|---|
| `--dry-run` | — | Nic nie zapisuje do bazy; tylko raportuje, co by zmienił. |
| `--limit N` | ∞ | Maks. liczba rekordów przetwarzanych w fazach 1–3. |
| `--no-search` | — | Pomija fazę 4 (wyszukiwarkę). |
| `--search-limit N` | ∞ | Maks. liczba rekordów w fazie 4. |
| `--only-search` | — | Pomija fazy 1–3, robi tylko fazę 4 (dobijanie po blokadzie). |
| `--retry-search` | — | Ignoruje dziennik prób — próbuje wszystkie rekordy od nowa. |
| `--search-cooldown DNI` | `14` | Ile dni pomijać rekordy próbowane w wyszukiwarce ostatnio. |
| `--concurrency N` | `8` | Równoległość pobierania stron. |
| `--timeout MS` | `10000` | Timeout pojedynczego pobrania strony (ms). |

Skrypt sam ustawia `NODE_TLS_REJECT_UNAUTHORIZED=0` (stare strony instytucji
kultury notorycznie mają wygasłe certyfikaty; pobierane są tylko strony publiczne).

```bash
# Podgląd bez zapisu, pierwsze 50 rekordów, bez wyszukiwarki
node scripts/enrich_contacts.js --dry-run --limit 50 --no-search

# Tylko wyszukiwarka, 100 rekordów, ignorując dziennik
node scripts/enrich_contacts.js --only-search --search-limit 100 --retry-search
```

### `scripts/vendor.js` — zasoby front-endu (`npm run vendor`)

```bash
node scripts/vendor.js
```

Kopiuje Bootstrap CSS/JS, Bootstrap Icons + fonty, font Inter (wagi 400–700)
i generuje `public/vendor/fonts/inter.css`. Bez argumentów. Uruchom po zmianie
wersji tych paczek w `package.json`. Wynik commitowany do repo (serwujemy
z własnego serwera, nie z CDN — RODO).

### `scripts/generate-og-image.js` — obraz OG (`npm run og-image`)

```bash
node scripts/generate-og-image.js
```

Buduje `public/images/og-cover.png` (liczba instytucji zaokrąglona w dół do setki,
domena z `PUBLIC_BASE_URL`). Bez argumentów. Uruchom z produkcyjnym env przed
publikacją. Wymaga fontu Inter w systemie (inaczej dobierze najbliższy sans-serif).

### `scripts/test-db.js` — kopia bazy dla testów

```bash
node scripts/test-db.js
```

Tworzy `data/test.sqlite` jako kopię `data/bdik.sqlite` (przez API backupu
SQLite — uwzględnia WAL) i wykonuje na niej migracje. Wywoływane automatycznie
przez `npm test`; ręcznie potrzebne tylko przy uruchamianiu pojedynczych testów.

---

## 5. Testy

```bash
npm test                                              # wszystko (tworzy kopię bazy)
node scripts/test-db.js && DB_PATH=data/test.sqlite node --test tests/pricing.test.js   # jeden plik
DB_PATH=data/test.sqlite node --test tests/*.test.js  # jeśli data/test.sqlite już istnieje
```

Testy wymagają istniejącego `data/bdik.sqlite` (źródło kopii). Uruchamiaj je
**zawsze** z `DB_PATH=data/test.sqlite` — inaczej tworzone w testach zamówienia
i zdarzenia zaśmiecą produkcyjną bazę.

Pliki testowe: `contact_pricing`, `dedup`, `enrich`, `etl_sources`, `normalize`,
`orderEmail`, `orders`, `pricing`, `projection`, `query`, `stats`, `visits`
(w `tests/*.test.js`).

---

## 6. Zmienne środowiskowe (`.env`)

Wzorzec: `.env.example`. Grupy:

### Serwer / sesja

| Zmienna | Domyślnie | Opis |
|---|---|---|
| `PORT` | `3000` | Port nasłuchu. |
| `NODE_ENV` | `development` | `production` włącza secure cookies (wymaga HTTPS), ogranicza ETL do realnych źródeł, wycisza logi. |
| `SESSION_SECRET` | — | **Wymagane.** Długi losowy ciąg — podpis ciasteczka sesji. |
| `DB_PATH` | `./data/bdik.sqlite` | Ścieżka do bazy SQLite. |

### Google OAuth (logowanie)

| Zmienna | Opis |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Dane klienta OAuth. Brak → `/auth/google` zwraca 503. |
| `GOOGLE_CALLBACK_URL` | Musi być identyczny co do znaku z „Authorized redirect URI" w Google Cloud Console. |

### Stripe (płatności za eksport)

| Zmienna | Opis |
|---|---|
| `STRIPE_SECRET_KEY` | Klucz ograniczony `rk_...` wystarczy (Checkout Sessions [write] + PaymentIntents [read]). Brak → checkout zwraca 503. |
| `STRIPE_PUBLISHABLE_KEY` | Klucz publiczny do modala Checkout. |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` — z `stripe listen` lokalnie albo z Dashboardu na produkcji. |
| `PUBLIC_BASE_URL` | Bezwzględny adres serwisu — `return_url` po płatności, canonical URL-e, sitemap, obraz OG. |
| `STRIPE_TAX_RATE_ID` | `txr_...` — puste = aplikacja utworzy stawkę VAT 23% sama i zapamięta. |

### Dane sprzedawcy (stopka, regulamin, e-mail, faktura)

| Zmienna | Opis |
|---|---|
| `SELLER_NAME`, `SELLER_ADDRESS`, `SELLER_NIP`, `SELLER_REGON`, `SELLER_EMAIL` | Dane rejestrowe. **Na produkcji wymagany komplet** (nazwa + adres + NIP + e-mail), inaczej stopka pokaże braki. |

### E-mail (SMTP, trwały nośnik)

| Zmienna | Domyślnie | Opis |
|---|---|---|
| `SMTP_HOST` | — | Brak → wysyłka pomijana (ostrzeżenie w logu), aplikacja działa. |
| `SMTP_PORT` | `587` | |
| `SMTP_USER` / `SMTP_PASS` | — | Poświadczenia SMTP. |
| `MAIL_FROM` | `SMTP_USER` | Adres nadawcy. |
| `LEAD_PROMO_CODE` | `DISCOUNT20` | Kod promocyjny Stripe doklejany do e-maila z próbką dla leadów. |

### Administracja

| Zmienna | Domyślnie | Opis |
|---|---|---|
| `ADMIN_EMAILS` | — | Adresy z uprawnieniami admina (`/admin/*`), po przecinku. Działa też konto z rolą `admin` w bazie. |
| `EXPORT_BACKUP_DIR` | `./data/exports` | Katalog na kopie zapasowe wygenerowanych plików eksportu (poza `public/`). |

### Ustawiane wewnętrznie (nie w `.env`)

| Zmienna | Gdzie | Opis |
|---|---|---|
| `RIK_LIVE` | ETL (sekcja 3) | `true` → RIK czyta żywe API. |
| `NODE_TLS_REJECT_UNAUTHORIZED` | `scripts/enrich_contacts.js` | Skrypt sam ustawia `0`. |

---

## 7. PM2 (produkcja)

Konfiguracja: `ecosystem.config.js` (aplikacja `bdik-website`, `NODE_ENV=production`).

| Komenda | Opis |
|---|---|
| `pm2 start ecosystem.config.js` | Pierwsze uruchomienie. |
| `pm2 restart bdik-website` | Restart po `git pull` / zmianie `.env` (watching wyłączony — zmiany na dysku nie wchodzą do działającego procesu bez restartu). |
| `pm2 reload bdik-website` | Restart bez przerwy (dla fork mode ~= restart). |
| `pm2 stop bdik-website` / `pm2 delete bdik-website` | Zatrzymanie / usunięcie z listy. |
| `pm2 logs bdik-website` | Podgląd logów na żywo. |
| `pm2 logs bdik-website --lines 200` | Ostatnie 200 linii. |
| `pm2 list` | Status wszystkich procesów. |
| `pm2 save` | Zapisuje listę procesów (odtworzenie po reboocie serwera). |

---

## 8. Stripe CLI (lokalne testy webhooka)

```bash
stripe listen --forward-to localhost:3000/webhooks/stripe
```

Wypisze `whsec_...` — wklej do `STRIPE_WEBHOOK_SECRET` w `.env`. Webhook jest
zamontowany **przed** `express.json()` (`express.raw()`), bo podpis Stripe to
HMAC nad surowym ciałem żądania. Zdarzenia są idempotentne (tabela
`stripe_events`).

```bash
stripe trigger checkout.session.completed   # sztuczne zdarzenie testowe
```

---

## 9. Weryfikacja lokalna na kopii bazy

Wzorzec ze skilla `verify` (`.claude/skills/verify/SKILL.md`):

```bash
cp data/bdik.sqlite /tmp/verify.sqlite
DB_PATH=/tmp/verify.sqlite PORT=3457 SESSION_SECRET=verify node app.js > /tmp/server.log 2>&1 &
curl -s localhost:3457/healthz          # {"status":"ok"}
curl -s localhost:3457/baza             # / to 301 na /baza
# sprzątanie:
lsof -ti :3457 | xargs kill
```

`db/index.js` wykonuje `db/schema.sql` przy każdym starcie (nowe tabele
`CREATE TABLE IF NOT EXISTS` powstają same; nowe kolumny wymagają `ensureColumn`).

---

## 10. Endpointy HTTP przydatne operatorowi

| Metoda i ścieżka | Opis |
|---|---|
| `GET /healthz` | Health check → `{"status":"ok"}`. |
| `GET /robots.txt`, `GET /sitemap.xml` | Budowane z listy `PUBLIC_PAGES` (`routes/pages.js`). |
| `GET /admin` | Panel logowania administratora (poza Google OAuth). |
| `GET /admin/orders` | Lista zamówień (wymaga admina). |
| `GET /admin/stats` | Statystyki lejka sprzedażowego. |
| `GET /admin/orders/:id/plik` | Ponowne pobranie pliku zamówienia (fallback, gdy klient potrzebuje re-dostawy). |
| `POST /api/checkout/quote` | Wycena (liczba rekordów z bazy, cena z `lib/pricing.js`). |
| `GET /platnosc?session_id=...` | Strona powrotu po płatności (poll + re-sync ze Stripe). |
| `GET /pobierz/:id` | Bramka pobierania pliku (kryteria z zamówienia, link 7 dni / limit pobrań). |
| `POST /webhooks/stripe` | Źródło prawdy o stanie płatności (podpis HMAC, idempotencja). |

---

## 11. Typowy deploy na serwerze

```bash
cd ~/websites/bdik-website
git pull                       # albo: git fetch && git reset --hard origin/main
npm ci                         # jeśli zmieniły się zależności
npm run vendor                 # jeśli zmieniły się wersje Bootstrap/Inter/ikon
NODE_ENV=production npm run etl # jeśli zmienił się seed lub źródła danych
node scripts/build_sample_export.js   # jeśli ETL zmienił dane albo zmieniły się SELLER_*
pm2 restart bdik-website
pm2 logs bdik-website --lines 50
```
