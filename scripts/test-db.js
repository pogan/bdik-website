// Przygotowanie jednorazowej kopii bazy dla testów (npm test uruchamia je z
// DB_PATH=data/test.sqlite). Testy tworzą zamówienia i zdarzenia - bez kopii
// zaśmiecałyby data/bdik.sqlite (tak właśnie powstały setki testowych zamówień).
// Kopia przez API backupu SQLite, nie fs.copyFile - uwzględnia strony z WAL.
const path = require('path');
const Database = require('better-sqlite3');

const src = path.join(__dirname, '..', 'data', 'bdik.sqlite');
const dest = path.join(__dirname, '..', 'data', 'test.sqlite');

const db = new Database(src, { readonly: true });
db.backup(dest)
  .then(() => {
    db.close();
    // Migracje (schema + ensureColumn) wykonujemy na kopii JUŻ TERAZ, w jednym
    // procesie. node --test odpala pliki testowe równolegle - gdyby każdy proces
    // migrował sam, dwa ALTER TABLE ścigałyby się o tę samą kolumnę.
    process.env.DB_PATH = dest;
    require('../db').close();
    console.log('Testowa kopia bazy gotowa: data/test.sqlite');
  })
  .catch((err) => {
    console.error('Nie udało się przygotować testowej kopii bazy:', err.message);
    process.exit(1);
  });
