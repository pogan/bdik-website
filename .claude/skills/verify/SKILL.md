---
name: verify
description: Uruchomienie bdik-website lokalnie na kopii bazy i przeklikanie zmiany w przeglądarce.
---

# Weryfikacja zmian w bdik-website

## Uruchomienie na kopii bazy

Nigdy nie uruchamiaj weryfikacji na `data/bdik.sqlite` - zdarzenia, wizyty i
zamówienia zapisałyby się do prawdziwej bazy. Skopiuj ją do scratchpada:

```bash
cp data/bdik.sqlite "$SCRATCH/verify.sqlite"
DB_PATH=$SCRATCH/verify.sqlite PORT=3457 SESSION_SECRET=verify node app.js > $SCRATCH/server.log 2>&1 &
curl -s localhost:3457/healthz   # {"status":"ok"}
```

`db/index.js` wykonuje `db/schema.sql` przy każdym starcie, więc nowe tabele
(`CREATE TABLE IF NOT EXISTS`) powstają same. Nowe kolumny w istniejących
tabelach wymagają `ensureColumn` - samo schema.sql ich nie doda.

## Sesja administratora bez Google OAuth

`isAdmin` (lib/projection.js) wymaga `req.user.role === 'admin'`, a logowanie
idzie przez Google. Do testów wstaw użytkownika i podpisaną sesję wprost do
bazy (`cookie-signature` + `SESSION_SECRET`, tabela `sessions`, JSON z
`passport.user = <id>`), a potem:

```bash
curl -s --cookie 'connect.sid=s:<sid>.<podpis>' localhost:3457/baza
```

Rozszerzenie Chrome blokuje ustawianie `document.cookie`, więc widok admina
sprawdzaj curl-em; w przeglądarce zostaje widok anonimowy.

## Klikanie w przeglądarce

- `/` to 301 na `/baza` - curl-uj `/baza`, nie `/`.
- Kliknięcia przez `ref_*` (find + left_click) potrafią nie odpalić handlerów.
  Realne kliknięcie po współrzędnych ze screenshota działa - jeśli zdarzenie
  nie doszło, sprawdź to najpierw, zanim uznasz kod za zepsuty.
- Natywne `<select>` nie reagują na Down/Return - do filtrów użyj pola
  "Szukaj po nazwie".
- Przyciski CSV/XLSX/PDF otwierają modal Stripe. Przy skonfigurowanych kluczach
  (.env ma testowe) modal wstaje normalnie; bez nich `openCheckout` woła
  `alert()`, który zablokuje sesję przeglądarki.

## Sprzątanie

```bash
lsof -ti :3457 | xargs kill
```
