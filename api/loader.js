'use strict';
const fs = require('fs');
const path = require('path');
const u = require('../server/util');

// Main loader developer: isi dari file server/main.lua (edit lewat GitHub, push, otomatis deploy).
module.exports = async (req, res) => {
  u.cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.query.debug === '1') return u.debug(req, res);
  if (req.method !== 'GET') return u.json(res, 405, { error: 'Method tidak didukung.' });
  if (u.decide(req.headers).browser) return u.redirectHome(req, res);
  try {
    const code = fs.readFileSync(path.join(__dirname, '..', 'server', 'main.lua'), 'utf8');
    return u.text(res, 200, code);
  } catch {
    return u.text(res, 200, '-- main loader belum diisi');
  }
};
