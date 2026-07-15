# Baza Danych Instytucji Kultury (bdik-website) - MVP

Aplikacja udostępniająca bazę polskich instytucji kultury. Publiczny podgląd
(nazwa, województwo, miejscowość) jest darmowy; pełne dane kontaktowe
(telefon, e-mail, adres, REGON/NIP...) wymagają logowania Google z allowlisty.
Eksport danych (CSV/XLSX/PDF) jest **płatny** - patrz "Płatności (Stripe)".

## ⚠️ Ostrzeżenie: nigdy nie otwieraj `druga_baza_danych.csv` w Excelu

Excel automatycznie obcina wiodące zera w kolumnie `Regon`, co psuje klucz
główny całej bazy (REGON jest unikalny i służy do deduplikacji rekordów).
Do podglądu/edycji danych źródłowych używaj edytora tekstu, `csvkit`, albo
importuj kolumnę REGON jawnie jako tekst.

## Wymagania

- Node.js 20+ (testowano na Node 24)
- npm

## Instalacja

```bash
npm install
cp .env.example .env
# uzupełnij SESSION_SECRET oraz (opcjonalnie na start) GOOGLE_CLIENT_ID/SECRET
```

## Wczytanie danych (ETL)

```bash
npm run etl
```

Wczytuje `kk_claude_data/druga_baza_danych.csv` (2229 instytucji) do
`data/bdik.sqlite`, plus mocki źródeł RIK/GUS/KRS/CEIDG (`sources/*.js`,
fixture'y w `sources/__fixtures__/`). Idempotentne - można uruchamiać
wielokrotnie, nie tworzy duplikatów. REGON jest kluczem naturalnym rekordu;
rekordy scalane są wg priorytetu źródeł GUS > RIK > KRS > CEIDG > seed
(`etl/dedup.js`) - pole nadpisywane jest tylko gdy przychodząca wartość jest
niepusta i źródło ma równy lub wyższy priorytet.

## Agent uzupełniania danych kontaktowych

```bash
npm run enrich                      # pełny przebieg (zapisuje do bazy)
node scripts/enrich_contacts.js --dry-run --limit 20   # próba bez zapisu
```

Cztery fazy: (1) weryfikacja istniejących adresów WWW z naprawą przez
obcinanie podstron/subdomen, (2) wyprowadzenie brakującego WWW z domeny
e-maila (pomija skrzynki publiczne typu gmail/wp), (3) uzupełnienie
telefonu/e-maila ze strony instytucji i jej podstron "kontakt",
(4) wyszukiwarka (DuckDuckGo) po nazwie i adresie pocztowym dla wpisów
wciąż niekompletnych.

Akceptacja obcej domeny (obcięta subdomena, wynik wyszukiwarki) wymaga
twardego potwierdzenia treści: miejscowość/kod pocztowy ORAZ niezależny
identyfikator instytucji (znany telefon, e-mail, ulica albo charakterystyczny
człon nazwy niepochodzący od miejscowości) - sama miejscowość nie wystarcza,
bo portal miasta zawsze ją zawiera. Dotyczy to także przekierowań na inny
host (republika.pl -> onet.pl, domena gminy -> samorzad.gov.pl) - wtedy
zapisywany jest pełny adres docelowy z podstroną, nie goły origin. Strony
parkingowe ("domena na sprzedaż") są odrzucane wszędzie, a oryginalny adres
dostaje ponowienie próby, żeby przejściowy timeout nie wysłał działającej
strony do "naprawy". Gdy strona jest martwa, a kandydat jest powiązany
treścią, lecz bez twardego identyfikatora (typowo strona gminy), agent
nie zapisuje go sam: pyta w terminalu albo odkłada do kolejki przeglądu.

E-maile za antyspamem: Cloudflare email-protection i wzorce [at]/[małpa]
są odszyfrowywane automatycznie; nieodczytywalne trafiają do promptu
(uruchomienie w terminalu) albo do kolejki `data/enrich_review.json`
(uruchomienie nieinteraktywne). Każda zmiana ląduje ze starą wartością
w raporcie `data/enrich_report.json`; martwe strony nie są kasowane,
tylko raportowane. Provenance: źródło `web_enrich` w `institution_sources`.

Faza 4 prowadzi dziennik prób (tabela `web_enrich_attempts`): każda
ukończona próba wyszukiwania zapisuje się od razu, więc przebieg przerwany
blokadą wyszukiwarki nie zaczyna następnym razem od zera - wpisy próbowane
w ciągu ostatnich 14 dni są pomijane, a nietknięte idą pierwsze. Po blokadzie
wystarczy odczekać i uruchomić `node scripts/enrich_contacts.js --only-search`.

Flagi: `--dry-run` (bez zapisu), `--limit N` (ogranicza każdą fazę),
`--no-search` / `--search-limit N` (faza 4), `--only-search` (pomija fazy 1-3),
`--retry-search` (ignoruje dziennik prób), `--search-cooldown DNI`
(domyślnie 14), `--concurrency N` (domyślnie 8), `--timeout MS`
(domyślnie 10000).

## Uruchomienie

```bash
npm start          # produkcyjnie
npm run dev         # z auto-restartem (node --watch)
```

Domyślnie nasłuchuje na porcie z `PORT` (domyślnie 3000).

## Logowanie Google - model allowlisty

Logowanie **nie tworzy** nowych kont automatycznie. Aby ktoś mógł się
zalogować, jego e-mail musi wcześniej istnieć w tabeli `users`:

```bash
node scripts/add_user.js ktos@example.com viewer/admin
```

Konfiguracja OAuth (Google Cloud Console -> OAuth consent screen + Credentials):
ustaw `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` w `.env`
(callback musi wskazywać na `https://twoja-domena/auth/google/callback`).
Bez tych zmiennych `/auth/google` zwraca 503 zamiast się wywalać.

## Płatności (Stripe)

Eksport pliku jest płatny. Kliknięcie CSV/XLSX/PDF otwiera modal z osadzonym
Stripe Checkout (BLIK, Przelewy24, karta - zestaw metod ustawia się w
Dashboardzie Stripe, kod ich nie hardkoduje). Plik można pobrać wyłącznie po
potwierdzonej płatności.

### Konfiguracja

```bash
# .env
STRIPE_SECRET_KEY=rk_test_...        # wystarczy klucz ograniczony (restricted)
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
PUBLIC_BASE_URL=https://twoja-domena.pl
```

Lokalnie webhook przekierowuje CLI Stripe:

```bash
stripe listen --forward-to localhost:3000/webhooks/stripe
```

Na produkcji: Dashboard → Developers → Webhooks → endpoint `/webhooks/stripe`,
zdarzenia `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed`, `checkout.session.expired`.

Bez kluczy STRIPE_* aplikacja normalnie wstaje - płatności zwracają wtedy 503.

### Jak to działa (i dlaczego tak)

1. `POST /api/checkout/quote` - wycena. Liczba rekordów liczona z bazy
   (`countInstitutions`), cena z `lib/pricing.js`. Kwota **nigdy** nie pochodzi
   z przeglądarki.
2. `POST /api/checkout` - zakłada zamówienie (`orders`, status `pending`) i sesję
   Stripe Checkout z ceną inline (`price_data`), bez predefiniowanych produktów.
   Komplet kryteriów zapisuje się w `orders.filters` (JSON).
3. `POST /webhooks/stripe` - źródło prawdy o płatności. Zamontowany **przed**
   `express.json()` z `express.raw()`, bo podpis liczy HMAC z surowego body.
   Powtórki zdarzeń odsiewa tabela `stripe_events` (idempotencja).
4. `GET /platnosc?session_id=...` - strona powrotu; odpytuje status, bo BLIK
   potrafi potwierdzić się z opóźnieniem. Dociąga też stan wprost ze Stripe,
   gdy webhook nie zdążył (`syncOrderFromStripe`).
5. `GET /pobierz/:token` - generuje plik **z kryteriów zapisanych w zamówieniu**,
   nie z parametrów URL. To jest właściwa bramka: bez `status = 'paid'` nie ma
   pliku, a kupujący nie podmieni zakresu po zapłaceniu za mniejszy wycinek.
   Link wygasa po 7 dniach i ma limit 10 pobrań.

Cennik (`lib/pricing.js`): progi jak podatkowe - 0,25 zł/rekord do 100, potem
0,15 / 0,07 / 0,03 zł; minimum 19 zł, sufit 499 zł. Zmiana cennika to zmiana
stałych w tym jednym pliku.

`GET /api/institutions/export` zostaje jako furtka **wyłącznie dla admina**
(`users.role = 'admin'`) - dla pozostałych zwraca 403, żeby nie omijała płatności.

## Testy

```bash
npm test
```

Normalizacja (REGON + suma kontrolna, telefon, WWW, daty), deduplikacja/priorytet
źródeł, gating pól (projection), zapytania/filtry, cennik (`pricing.test.js`)
oraz cykl życia zamówienia i idempotencja webhooka (`orders.test.js`).

## Wdrożenie na VPS (PM2 + nginx)

### PM2

```bash
pm2 start ecosystem.config.js
pm2 save
```

`.env` musi leżeć w katalogu aplikacji (dotenv wczytuje go przy starcie).

### nginx (reverse proxy)

```nginx
server {
    listen 80;
    server_name baza-kultury.example.pl;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Aplikacja ma ustawione `trust proxy` i ciasteczka sesji z `secure: true` w
`NODE_ENV=production` - wymaga to nagłówka `X-Forwarded-Proto` od nginx
(jak wyżej) po podpięciu TLS (np. certbot), inaczej sesje nie przetrwają.

## Struktura projektu

```
app.js                  - punkt wejścia Express
db/schema.sql           - schemat SQLite (institutions, raw_*, users, orders, sessions...)
etl/                    - normalizacja, deduplikacja, orkiestracja ETL
sources/                - moduły źródeł (csv_seed=prawdziwy, rik/gus/krs/ceidg=mocki)
lib/                    - projection (gating pól), query (filtry/sort/paginacja),
                          exportFormats (CSV/XLSX/PDF), exportRun (wspólny stream),
                          pricing (cennik), orders (zamówienia), stripe, auth, sesje
routes/                 - api.js (JSON + eksport admina), auth.js (Google OAuth),
                          payments.js (checkout/status/pobieranie), webhooks.js (Stripe)
views/, public/         - EJS + Bootstrap 5 + Bootstrap Icons + Google Fonts
scripts/add_user.js     - dodawanie e-maili do allowlisty
```

## Znane ograniczenia MVP

- Rejestracja użytkowników nie jest zaimplementowana - dostęp do pełnych danych
  w tabeli reguluje allowlist w `users`; eksport pliku bramkuje płatność Stripe.
- Zamówienie nie wysyła e-maila z linkiem do pobrania - link żyje na stronie
  powrotu (`/platnosc`). Po zamknięciu karty klient musi mieć go zapisanego.
- Pole "typ instytucji" pominięte w MVP (dane PKD są już w bazie i eksporcie,
  więc dodanie klasyfikatora typu w przyszłości nie wymaga ponownego ETL).
- RIK nie ma jednego ogólnopolskiego API - `sources/rik.js` jest klientem
  API `dane.gov.pl` dla rejestru MKiDN (ustaw `RIK_LIVE=true`, by pobierać
  na żywo zamiast z fixture'a); reszta RIK-ów samorządowych wymagałaby
  osobnych integracji per BIP.
- `sources/gus.js`, `krs.js`, `ceidg.js` to mocki na fixture'ach - realne
  klucze API (GUS wymaga wniosku, KRS ma publiczne REST API) podłącza się
  przez podmianę `fetch()` w danym module, interfejs (`name`, `fetch`,
  `toCanonical`) zostaje bez zmian.
