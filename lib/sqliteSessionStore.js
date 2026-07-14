const session = require('express-session');

const ONE_DAY_MS = 86400000;

class SqliteSessionStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;
    this.stmts = {
      get: db.prepare('SELECT sess, expires FROM sessions WHERE sid = ?'),
      upsert: db.prepare(`
        INSERT INTO sessions (sid, expires, sess) VALUES (@sid, @expires, @sess)
        ON CONFLICT(sid) DO UPDATE SET expires = @expires, sess = @sess
      `),
      destroy: db.prepare('DELETE FROM sessions WHERE sid = ?'),
      touch: db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?'),
      clearExpired: db.prepare('DELETE FROM sessions WHERE expires < ?'),
    };
    this.cleanupTimer = setInterval(() => this.stmts.clearExpired.run(Date.now()), ONE_DAY_MS);
    this.cleanupTimer.unref();
  }

  get(sid, cb) {
    try {
      const row = this.stmts.get.get(sid);
      if (!row || row.expires < Date.now()) return cb(null, null);
      return cb(null, JSON.parse(row.sess));
    } catch (err) {
      return cb(err);
    }
  }

  set(sid, sessionData, cb) {
    try {
      const maxAge = (sessionData.cookie && sessionData.cookie.maxAge) || ONE_DAY_MS;
      this.stmts.upsert.run({ sid, expires: Date.now() + maxAge, sess: JSON.stringify(sessionData) });
      if (cb) cb(null);
    } catch (err) {
      if (cb) cb(err);
    }
  }

  destroy(sid, cb) {
    try {
      this.stmts.destroy.run(sid);
      if (cb) cb(null);
    } catch (err) {
      if (cb) cb(err);
    }
  }

  touch(sid, sessionData, cb) {
    try {
      const maxAge = (sessionData.cookie && sessionData.cookie.maxAge) || ONE_DAY_MS;
      this.stmts.touch.run(Date.now() + maxAge, sid);
      if (cb) cb(null);
    } catch (err) {
      if (cb) cb(err);
    }
  }
}

module.exports = SqliteSessionStore;
