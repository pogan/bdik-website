# SEO / GEO — stan i lista zadań

Dokument roboczy: co jest zrobione w kodzie/infrastrukturze i co zostaje do
zrobienia ręcznie (poza repozytorium). GEO = optymalizacja pod odpowiedzi
silników generatywnych (ChatGPT, Perplexity, Gemini, Google AI Overviews).

Domena kanoniczna: **`https://bdik.pl`** (bez `www`, https). `PUBLIC_BASE_URL`
w `.env` na serwerze musi być dokładnie taki — z niego liczą się canonical, OG,
sitemap, robots, JSON-LD i IndexNow.

---

## Zrobione (w kodzie / na serwerze)

### Fundamenty techniczne
- `robots.txt` + `sitemap.xml` budowane z `PUBLIC_PAGES` (`routes/pages.js`).
- Canonical + OG + Twitter Card na każdej publicznej stronie (`views/partials/head.ejs`).
- `meta robots` stron indeksowalnych: `index, follow, max-image-preview:large,
  max-snippet:-1, max-video-preview:-1`.
- Favicony rastrowe, `apple-touch-icon`, `site.webmanifest`, `theme-color`,
  `preload` fontów Inter 400/600 (`npm run icons`).
- Self-hosting CSS/JS/fontów (bez CDN) — było wcześniej.
- 301: `http://*` i `https://www.*` → `https://bdik.pl$request_uri` (nginx,
  jeden przeskok). HSTS `max-age=31536000; includeSubDomains`.

### Dane strukturalne (JSON-LD)
- `Organization` + `WebSite` na każdej stronie (`lib/structuredData.js`):
  `logo`, `image`, `description`, `contactPoint`, `legalName` vs brandowe `name`,
  `sameAs` z `ORG_SAME_AS`.
- `Dataset` na `/baza`: `dateModified`, `datePublished`, `spatialCoverage`,
  `temporalCoverage`, `variableMeasured`, `distribution` (`DataDownload`
  dla próbki PDF + płatnych CSV/XLSX/PDF), `publisher` — pod **Google Dataset Search**.
- `Product` + `AggregateOffer` na `/baza` (ceny z `lib/pricing.js`).
- `FAQPage` — tylko na `/faq` (nie dublujemy na `/baza`).
- `Article` na poradnikach (`routes/guides.js`).
- `BreadcrumbList` na stronach segmentów i poradników.

### Treść / strony
- Strony per województwo (16) i per typ instytucji (4) — było.
- **Strony per powiat** `/baza/wojewodztwo/:woj/powiat/:powiat` — tylko powiaty
  z ≥8 instytucjami, powiaty grodzkie ("M. …") wykluczone (`lib/geoPages.js`).
- **Strony województwo × typ** `/baza/wojewodztwo/:woj/typ/:typ` — ≥8 rekordów.
- Wszystkie strony segmentów: server-rendered próbka + rozkłady jako `<table>`
  (widoczne bez JS — crawlery, fetchery LLM), „Dane w stanie z dnia …".
- `/faq` — dedykowana, indeksowalna.
- `/poradniki` + 3 artykuły (koncert / warsztaty / „ile jest domów kultury"
  z żywymi liczbami).
- Menu górne z linkami do przeglądania (`views/partials/nav.ejs`).
- `llms.txt` zsynchronizowany + sekcja o cytowaniu z podaniem źródła.

### IndexNow (Bing/Yandex/Seznam — Google NIE uczestniczy)
- `lib/indexnow.js` + `scripts/indexnow.js` (`npm run indexnow`).
- Klucz: `public/405a103867e6a57669a3ee6888a6bec5.txt` (półjawny z założenia).
- `npm run enrich` w produkcji sam pinguje IndexNow, gdy coś realnie zmieni.
- **Aktywacja: patrz niżej — trzeba raz zgłosić klucz.**

---

## Do zrobienia ręcznie (poza repo)

Priorytety: **[1]** teraz, **[2]** w ciągu miesiąca, **[3]** ciągłe.

### [1] Google Search Console
- Sitemaps → dodaj `sitemap.xml`.
- URL Inspection → „Poproś o zindeksowanie" dla `/baza`, `/faq`, `/o-nas`,
  `/poradniki` + 3–4 największych stron powiatów/typów.
- Za ~tydzień: raport **Strony** — jeśli strony segmentów masowo lądują
  w „Zeskanowana, obecnie niezaindeksowana", podnieś `MIN_RECORDS`
  w `lib/geoPages.js` (np. 8 → 12) i wdróż ponownie.
- Sprawdź raporty **Web Vitals**, **Obsługa na urządzeniach mobilnych**
  i ulepszenia (FAQ / Zbiory danych / Produkty).

### [1] IndexNow — aktywacja
1. Zweryfikuj, że klucz jest publiczny:
   `curl https://bdik.pl/405a103867e6a57669a3ee6888a6bec5.txt`
   → ma zwrócić `405a103867e6a57669a3ee6888a6bec5`.
2. Pierwsze zgłoszenie: na serwerze `cd /home/ubuntu/websites/bdik-website && npm run indexnow`.
3. (Opcjonalnie) Bing Webmaster Tools → sekcja IndexNow potwierdzi odbiór.

### [1] Bing Webmaster Tools
- `bing.com/webmasters` → „Import from Google Search Console" (2 kliknięcia,
  przenosi weryfikację i sitemap).
- Zasila Copilot i częściowo ChatGPT Search.

### [2] Encja / graf wiedzy
- **Wikidata**: utwórz element dla serwisu/organizacji (jeśli spełnia
  notability — wzmianki w mediach, katalogach). Mocny sygnał dla Google
  Knowledge Graph i modeli AI.
- Rozważ akapit w odpowiednim artykule Wikipedii (np. „Dom kultury")
  z linkiem jako źródło danych liczbowych — bez spamu, tylko gdy realnie wnosi.

### [2] Cytowania i linki (NAP spójne: nazwa + adres + e-mail identyczne wszędzie)
- Katalogi: `ngo.pl`, `bazy.ngo.pl`, Aleo, Panorama Firm, regionalne portale
  kulturalne.
- Wzmianki na blogach/newsletterach muzycznych i kulturalnych, wątki na forach
  branżowych i Reddit (r/Polska, r/muzyka) — dają ruch i cytowania w GEO.
- Data-PR: raz w roku mini-raport „gdzie w Polsce brakuje domów kultury"
  z wykresem → pitch do mediów regionalnych.

### [2] Profile w serwisach zewnętrznych
- Załóż minimalny profil LinkedIn (i ew. Facebook) firmy.
- Wpisz ich adresy do `ORG_SAME_AS` w `.env` na serwerze (po przecinku),
  zrestartuj `pm2 reload bdik-website` — trafią do `Organization.sameAs`.

### [2] Google Business Profile
- **Pomiń**, chyba że pojawi się realny adres obsługi klienta. Dla produktu
  online zwykle odrzucany, niski zysk.

### [2] Analityka
- GSC wystarcza do monitoringu SEO. Jeśli chcesz zachowań użytkownika bez
  łamania zasady „zero third-party JS", rozważ self-hosted Plausible/Umami
  zamiast GA4. Obecny licznik wizyt (`lib/visits.js`) zostaje.

### [3] Monitoring GEO
- Raz w miesiącu zapytaj ChatGPT / Perplexity / Gemini / Google AI Overviews:
  „baza kontaktów do domów kultury", „lista domów kultury w Polsce",
  „ile jest bibliotek publicznych w Polsce" — sprawdź, czy `bdik.pl` jest
  cytowany. Notuj trend.
- Po każdym dużym `npm run enrich` lub dodaniu stron: `npm run indexnow`.

---

## Pliki, których to dotyczy

| Obszar | Plik |
|---|---|
| robots.txt / sitemap.xml | `app.js`, `routes/pages.js` (`PUBLIC_PAGES`) |
| meta / OG / favicony | `views/partials/head.ejs` |
| Organization / WebSite JSON-LD | `lib/structuredData.js` |
| Dataset / Product / FAQ / Article JSON-LD | `routes/pages.js`, `routes/guides.js` |
| strony powiatów i województwo×typ | `lib/geoPages.js`, `lib/slug.js` |
| poradniki | `lib/guides.js`, `views/poradniki/`, `views/guide.ejs` |
| IndexNow | `lib/indexnow.js`, `scripts/indexnow.js`, `public/<klucz>.txt` |
| ikony | `scripts/generate-icons.js` |
| nginx (301) | `/etc/nginx/sites-available/bdik-website` na serwerze |
