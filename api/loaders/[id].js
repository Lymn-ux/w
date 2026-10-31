'use strict';
const db = require('../../server/db');
const u = require('../../server/util');

const SLUG = /^[a-z0-9-]{1,40}$/;
const LIMIT_CREATE_PER_DAY = 10;  // per IP
const LIMIT_WRITE_PER_DAY = 200;  // per edit-token (edit + delete)

module.exports = async (req, res) => {
  u.cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.query.debug === '1') return u.debug(req, res);

  const id = String(req.query.id || '').toLowerCase();
  if (!SLUG.test(id)) return u.json(res, 400, { error: 'ID tidak valid.' });
  const key = 'loader:' + id;
  const token = req.headers['x-edit-token'] || '';

  try {
    // READ (publik): browser -> 302, executor -> text/plain. ?meta=1 + token -> JSON untuk pemilik.
    if (req.method === 'GET') {
      const row = await db.get(key);
      if (req.query.meta === '1') {
        if (!u.tokenOk(row, token)) return u.json(res, 403, { error: 'Token tidak cocok.' });
        return u.json(res, 200, { id, name: row.name, code: row.code, created: row.created, updated: row.updated });
      }
      if (u.decide(req.headers).browser) return u.redirectHome(req, res);
      if (!row) return u.text(res, 404, '-- loader tidak ditemukan');
      return u.text(res, 200, row.code);
    }

    // CREATE: siapa saja, asal slug belum dipakai.
    if (req.method === 'POST') {
      const b = await u.readBody(req);
      if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 60) return u.json(res, 400, { error: 'Nama script wajib diisi (maks 60 karakter).' });
      if (u.slugify(b.name) !== id) return u.json(res, 400, { error: 'Nama dan ID tidak cocok.' });
      if (typeof b.token !== 'string' || !/^[a-f0-9]{64}$/.test(b.token)) return u.json(res, 400, { error: 'Edit-token tidak valid.' });
      if (!u.codeOk(b.code)) return u.json(res, 413, { error: 'Kode kosong atau lebih dari 200KB.' });

      const n = await db.incr(`rl:c:${u.sha256(u.ip(req))}:${u.day()}`, 86400);
      if (n > LIMIT_CREATE_PER_DAY) return u.json(res, 429, { error: 'Batas pembuatan loader hari ini tercapai. Coba lagi besok.' });

      const now = Date.now();
      const ok = await db.setnx(key, { code: b.code, name: b.name.trim(), tokenHash: u.sha256(b.token), created: now, updated: now });
      if (!ok) return u.json(res, 409, { error: 'Nama sudah dipakai. Pilih nama lain.' });
      return u.json(res, 201, { id });
    }

    // EDIT / DELETE: token harus cocok dengan hash tersimpan.
    if (req.method === 'PUT' || req.method === 'DELETE') {
      const row = await db.get(key);
      if (!row) return u.json(res, 404, { error: 'Loader tidak ditemukan.' });
      if (!u.tokenOk(row, token)) return u.json(res, 403, { error: 'Token tidak cocok.' });

      const n = await db.incr(`rl:w:${row.tokenHash}:${u.day()}`, 86400);
      if (n > LIMIT_WRITE_PER_DAY) return u.json(res, 429, { error: 'Batas perubahan hari ini tercapai.' });

      if (req.method === 'DELETE') { await db.del(key); return u.json(res, 200, { ok: true }); }
      const b = await u.readBody(req);
      if (!u.codeOk(b.code)) return u.json(res, 413, { error: 'Kode kosong atau lebih dari 200KB.' });
      row.code = b.code; row.updated = Date.now(); // nama & tokenHash tetap
      await db.set(key, row);
      return u.json(res, 200, { ok: true, updated: row.updated });
    }

    return u.json(res, 405, { error: 'Method tidak didukung.' });
  } catch (e) {
    console.error('[loaders]', e);
    return u.json(res, 500, { error: 'Kesalahan server.' });
  }
};
