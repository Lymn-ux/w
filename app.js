(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const LS = 'sl_loaders';           // [{id, token}] -> edit-token asli hanya ada di browser ini
  const MAX = 200 * 1024;
  let editing = null;                // {id, token} saat mode edit
  const cache = {};                  // id -> data meta dari server

  const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(LS)) || []; } catch { return []; } },
    set(v) { localStorage.setItem(LS, JSON.stringify(v)); }
  };
  const genToken = () => {
    const a = new Uint8Array(32); crypto.getRandomValues(a);
    return [...a].map((b) => b.toString(16).padStart(2, '0')).join(''); // 64 hex
  };
  const linkOf = (id) => location.origin + '/loaders/' + id;
  const snippetOf = (id) => `loadstring(game:HttpGet("${linkOf(id)}"))()`;
  const bytes = (s) => new Blob([s]).size;

  async function copy(t) {
    try { await navigator.clipboard.writeText(t); return true; }
    catch {
      const a = document.createElement('textarea');
      a.value = t; a.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(a); a.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch {}
      a.remove(); return ok;
    }
  }
  let tt;
  function toast(msg, err) {
    const t = $('#toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
    clearTimeout(tt); tt = setTimeout(() => (t.className = ''), 2400);
  }
  function setStep(n) {
    document.querySelectorAll('#steps li').forEach((li) => {
      const s = +li.dataset.s;
      li.className = n === 3 ? 'done' : s < n ? 'done' : s === n ? 'active' : '';
    });
  }
  async function api(method, id, { token, body, q = '' } = {}) {
    const r = await fetch('/loaders/' + id + q, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { 'x-edit-token': token } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    let data = {}; try { data = await r.json(); } catch {}
    return { ok: r.ok, status: r.status, data };
  }
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls; if (text != null) e.textContent = text; return e;
  }

  // ---------- form ----------
  const nameI = $('#name'), codeI = $('#code'), btn = $('#submit'), cancelB = $('#cancel');

  nameI.addEventListener('input', () => { $('#slug').textContent = slugify(nameI.value) || '-'; });
  codeI.addEventListener('input', () => {
    $('#size').textContent = (bytes(codeI.value) / 1024).toFixed(1) + ' KB';
    if (!$('#result').hidden && !editing) $('#result').hidden = true;
    setStep(1);
  });

  function resetForm() {
    editing = null; nameI.disabled = false; nameI.value = ''; codeI.value = '';
    $('#slug').textContent = '-'; $('#size').textContent = '0 KB';
    btn.textContent = 'Generate loader'; cancelB.hidden = true;
  }
  cancelB.addEventListener('click', () => { resetForm(); setStep(1); });

  btn.addEventListener('click', async () => {
    const code = codeI.value;
    if (!code.trim()) return toast('Kode masih kosong.', true);
    if (bytes(code) > MAX) return toast('Kode melebihi 200KB.', true);
    btn.disabled = true;
    try {
      if (editing) {
        const r = await api('PUT', editing.id, { token: editing.token, body: { code } });
        if (!r.ok) return toast(r.data.error || 'Gagal menyimpan.', true);
        toast('Saved'); resetForm(); setStep(3); await renderList(); return;
      }
      const name = nameI.value.trim(), id = slugify(name);
      if (!id) return toast('Nama script wajib diisi.', true);
      setStep(2);
      const token = genToken();
      const r = await api('POST', id, { body: { name, token, code } });
      if (!r.ok) { setStep(1); return toast(r.data.error || 'Gagal membuat loader.', true); }
      const list = store.get(); list.push({ id, token }); store.set(list);
      $('#link').textContent = linkOf(id); $('#snip').textContent = snippetOf(id);
      $('#result').hidden = false;
      const ok = await copy(snippetOf(id));
      toast(ok ? 'Loader dibuat, snippet disalin' : 'Loader dibuat, tekan Copy');
      setStep(3); resetForm(); setStep(3);
      await renderList();
    } catch { setStep(1); toast('Jaringan bermasalah.', true); }
    finally { btn.disabled = false; }
  });

  document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    toast((await copy($('#' + b.dataset.copy).textContent)) ? 'Copied' : 'Gagal menyalin', false);
  }));

  // ---------- daftar ----------
  async function renderList() {
    const box = $('#list');
    const entries = store.get();
    const res = await Promise.all(entries.map((e) =>
      api('GET', e.id, { token: e.token, q: '?meta=1' }).catch(() => null)));
    const keep = [];
    box.replaceChildren();
    entries.forEach((e, i) => {
      const r = res[i];
      if (r && !r.ok && (r.status === 403 || r.status === 404)) return; // sudah dihapus / token tak cocok
      keep.push(e);
      const d = r && r.ok ? (cache[e.id] = r.data) : cache[e.id];
      const item = el('div', 'item');
      item.appendChild(el('h3', '', d ? d.name : e.id));
      item.appendChild(el('div', 'meta', linkOf(e.id) + (d ? ' · dibuat ' + new Date(d.created).toLocaleString() + ' · diubah ' + new Date(d.updated).toLocaleString() : '')));
      const acts = el('div', 'acts');
      const bCopy = el('button', 'small', 'Copy');
      bCopy.onclick = async () => toast((await copy(snippetOf(e.id))) ? 'Copied' : 'Gagal menyalin');
      const bEdit = el('button', 'small', 'Edit');
      bEdit.onclick = () => {
        if (!cache[e.id]) return toast('Data belum termuat.', true);
        editing = e; nameI.value = cache[e.id].name; nameI.disabled = true; // nama terkunci
        $('#slug').textContent = e.id; codeI.value = cache[e.id].code;
        $('#size').textContent = (bytes(codeI.value) / 1024).toFixed(1) + ' KB';
        btn.textContent = 'Save changes'; cancelB.hidden = false; $('#result').hidden = true;
        setStep(1); window.scrollTo({ top: 0, behavior: 'smooth' });
      };
      const bDel = el('button', 'small danger', 'Delete');
      bDel.onclick = async () => {
        if (!confirm('Hapus loader "' + (d ? d.name : e.id) + '"? Link akan mati.')) return;
        const x = await api('DELETE', e.id, { token: e.token });
        if (!x.ok) return toast(x.data.error || 'Gagal menghapus.', true);
        store.set(store.get().filter((s) => s.id !== e.id)); delete cache[e.id];
        if (editing && editing.id === e.id) resetForm();
        toast('Deleted'); renderList();
      };
      acts.append(bCopy, bEdit, bDel); item.appendChild(acts); box.appendChild(item);
    });
    store.set(keep);
    if (!keep.length) box.appendChild(el('div', 'empty', 'Belum ada loader di browser ini.'));
  }

  renderList();
})();
