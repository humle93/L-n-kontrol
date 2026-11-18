import { VERSION } from './version.js';
import { parsePayslip, parseNumberDa } from './parse.js';
import { runChecks } from './checks.js';
import * as db from './store.js';

const $ = (s) => document.querySelector(s);
const kr = (n) => n == null ? '–' : n.toLocaleString('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kr';
const ICON = { ok: '✅', warn: '⚠️', fail: '❌', info: 'ℹ️' };
const MONTHS = ['januar','februar','marts','april','maj','juni','juli','august','september','oktober','november','december'];
const FIELD_LABELS = {
  amIndkomst: 'AM-indkomst', amBidrag: 'AM-bidrag', aSkat: 'A-skat', traek: 'Trækprocent (%)', fradrag: 'Fradrag',
  atp: 'ATP (din andel)', pensionEgen: 'Pension (egen)', pensionFirma: 'Pension (firma)', brutto: 'Bruttoløn',
  netto: 'Udbetalt', feriepenge: 'Feriepenge', ferietillaeg: 'Ferietillæg', timer: 'Timer',
};

$('#ver').textContent = VERSION;
let current = null; // aktuel lønseddel

// ---------- Indstillinger ----------
const DEFAULT_SETTINGS = { periode: 'maaned', startTimeloen: 160 };
function getSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('lk-settings') || '{}') }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
function setSettings(s) { try { localStorage.setItem('lk-settings', JSON.stringify(s)); } catch {} }

// ---------- Visning ----------
function show(view) {
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== `view-${view}`;
  for (const a of document.querySelectorAll('[data-nav]')) a.classList.toggle('on', a.dataset.nav === view);
  window.scrollTo(0, 0);
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3500);
}
function periodName(p) {
  if (!p?.key) return 'Ukendt periode';
  const [y, m] = p.key.split('-').map(Number);
  return `${MONTHS[m - 1][0].toUpperCase()}${MONTHS[m - 1].slice(1)} ${y}`;
}

async function renderHome() {
  const s = getSettings();
  const list = await db.all();
  list.sort((a, b) => (b.period?.key || '').localeCompare(a.period?.key || '') || b.created - a.created);
  $('#history-title').hidden = !list.length;
  $('#history').innerHTML = '';
  for (const slip of list) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="st">${ICON[slip.result.overall]}</span><div><div class="p"></div><div class="n"></div></div>`;
    li.querySelector('.p').textContent = periodName(slip.period);
    li.querySelector('.n').textContent = `Udbetalt ${kr(slip.fields.netto)}`;
    li.onclick = () => { location.hash = `#slip/${slip.id}`; };
    $('#history').append(li);
  }
  $('#setup-nudge').hidden = !!s.nyTimeloen || !list.length;
  show('home');
}

function renderResult(slip) {
  current = slip;
  const r = slip.result;
  const fails = r.checks.filter((c) => c.status === 'fail').length;
  const warns = r.checks.filter((c) => c.status === 'warn').length;
  const b = $('#banner');
  b.className = `banner ${r.overall}`;
  b.innerHTML = '';
  b.append(r.overall === 'ok' ? '✅ Lønsedlen ser rigtig ud' : r.overall === 'warn' ? `⚠️ ${warns} ting bør tjekkes` : `❌ ${fails} fejl fundet`);
  const sm = document.createElement('small'); sm.textContent = periodName(slip.period); b.append(sm);

  const figs = [['Udbetalt', slip.fields.netto], ['AM-indkomst', slip.fields.amIndkomst], ['A-skat', slip.fields.aSkat], ['Timeløn', r.rate]];
  $('#figures').innerHTML = '';
  for (const [l, v] of figs) {
    const d = document.createElement('div'); d.className = 'fig';
    d.innerHTML = '<div class="l"></div><div class="v"></div>';
    d.querySelector('.l').textContent = l; d.querySelector('.v').textContent = kr(v);
    $('#figures').append(d);
  }
  $('#checks').innerHTML = '';
  for (const c of r.checks) {
    const li = document.createElement('li'); li.className = c.status;
    li.innerHTML = '<div class="t"></div><div class="d"></div>';
    li.querySelector('.t').textContent = `${ICON[c.status]} ${c.title}`;
    li.querySelector('.d').textContent = c.detail || '';
    $('#checks').append(li);
  }
  show('result');
}

// ---------- Analyse ----------
async function previousFor(slip) {
  const list = (await db.all()).filter((s) => s.id !== slip.id && s.period?.key && slip.period?.key && s.period.key < slip.period.key);
  list.sort((a, b) => b.period.key.localeCompare(a.period.key));
  return list[0] ? { fields: list[0].fields, rate: list[0].result.rate } : null;
}

async function effectiveSettings() {
  const s = getSettings();
  if (!s.startMaaned) {
    // Ingen startmåned angivet: brug den ældste gemte lønseddel
    const keys = (await db.all()).map((x) => x.period?.key).filter(Boolean).sort();
    if (keys[0]) s.startMaaned = keys[0];
  }
  return s;
}

async function evaluate(slip) {
  slip.result = runChecks(slip, await effectiveSettings(), await previousFor(slip));
  return slip;
}

async function handleFile(file) {
  if (!file) return;
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  if (!isPdf) { toast('Vælg lønsedlen som PDF (fra e-Boks: Del → LønKontrol).'); return; }
  show('busy');
  try {
    const { pdfToLines } = await import('./pdf-text.js');
    const { lines, hasText } = await pdfToLines(await file.arrayBuffer());
    if (!hasText) { toast('PDF\'en indeholder ingen tekst (scannet billede). Kan ikke læses endnu.'); return renderHome(); }
    const parsed = parsePayslip(lines);
    const existing = parsed.period?.key ? (await db.all()).find((s) => s.period?.key === parsed.period.key) : null;
    const slip = { id: existing?.id || crypto.randomUUID(), created: Date.now(), fileName: file.name || 'lønseddel.pdf', ...parsed };
    await evaluate(slip);
    await db.put(slip);
    if (existing) toast('Erstattede den tidligere lønseddel for samme periode.');
    location.hash = `#slip/${slip.id}`;
    if (parsed.found.length < 3) toast('Jeg fandt få tal – tryk "Ret tal" og udfyld de vigtigste.');
  } catch (e) {
    console.error(e);
    toast('Kunne ikke læse filen. Prøv igen eller del den på ny fra e-Boks.');
    renderHome();
  }
}

// ---------- Del fra e-Boks (Web Share Target) ----------
async function processShareInbox() {
  if (!('caches' in window)) return false;
  const cache = await caches.open('lk-inbox');
  const keys = await cache.keys();
  if (!keys.length) return false;
  for (const req of keys) {
    const res = await cache.match(req);
    const blob = await res.blob();
    const name = decodeURIComponent(res.headers.get('x-filename') || 'lønseddel.pdf');
    await cache.delete(req);
    await handleFile(new File([blob], name, { type: blob.type || 'application/pdf' }));
  }
  return true;
}

// Åbn PDF fra computerens filhåndtering (file_handlers)
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (params) => {
    for (const h of params.files || []) handleFile(await h.getFile());
  });
}

// ---------- Ret tal ----------
function renderEdit() {
  if (!current) return renderHome();
  const f = $('#edit-form'); f.innerHTML = '';
  for (const [k, label] of Object.entries(FIELD_LABELS)) {
    const l = document.createElement('label'); l.textContent = label;
    const i = document.createElement('input'); i.name = k; i.inputMode = 'decimal';
    const v = current.fields[k];
    i.value = v == null ? '' : String(v).replace('.', ',');
    l.append(i); f.append(l);
  }
  const l = document.createElement('label'); l.textContent = 'Periode (måned)';
  const i = document.createElement('input'); i.type = 'month'; i.name = '_period'; i.value = current.period?.key || '';
  l.append(i); f.append(l);
  show('edit');
}
$('#btn-save-edit').onclick = async () => {
  const fd = new FormData($('#edit-form'));
  for (const k of Object.keys(FIELD_LABELS)) current.fields[k] = parseNumberDa(fd.get(k));
  const pk = fd.get('_period');
  if (pk) current.period = { ...(current.period || {}), key: pk };
  await evaluate(current); await db.put(current);
  toast('Gemt'); location.hash = `#slip/${current.id}`;
};

// ---------- Del / slet ----------
$('#btn-share').onclick = async () => {
  const r = current.result;
  const text = [`LønKontrol – ${periodName(current.period)}`, `Udbetalt: ${kr(current.fields.netto)}`, '',
    ...r.checks.filter((c) => c.status !== 'info' || c.id === 'timeloen').map((c) => `${ICON[c.status]} ${c.title}${c.detail ? '\n   ' + c.detail.replace(/\n/g, '\n   ') : ''}`)].join('\n');
  try {
    if (navigator.share) await navigator.share({ title: 'LønKontrol', text });
    else { await navigator.clipboard.writeText(text); toast('Kopieret – sæt ind i en besked eller mail.'); }
  } catch {}
};
$('#btn-edit').onclick = () => { location.hash = `#edit/${current.id}`; };
$('#btn-delete').onclick = async () => {
  if (!confirm('Slet denne lønseddel fra LønKontrol?')) return;
  await db.remove(current.id); current = null; location.hash = '#';
};

// ---------- Indstillinger ----------
function renderSettings() {
  const s = getSettings(); const f = $('#settings-form');
  f.periode.value = s.periode || 'maaned';
  for (const k of ['startTimeloen', 'nyTimeloen', 'traek', 'fradrag']) f[k].value = s[k] == null ? '' : String(s[k]).replace('.', ',');
  f.startMaaned.value = s.startMaaned || '';
  show('settings');
}
$('#btn-save-settings').onclick = async () => {
  const f = $('#settings-form');
  const s = { periode: f.periode.value || 'maaned', startMaaned: f.startMaaned.value || null };
  for (const k of ['startTimeloen', 'nyTimeloen', 'traek', 'fradrag']) s[k] = parseNumberDa(f[k].value);
  setSettings(s);
  for (const slip of await db.all()) { await evaluate(slip); await db.put(slip); } // tjek alle igen
  toast('Gemt – alle lønsedler er tjekket igen.');
};
$('#btn-export').onclick = async () => {
  const data = JSON.stringify({ app: 'LønKontrol', version: VERSION, settings: getSettings(), slips: await db.all() });
  const file = new File([data], `lonkontrol-backup-${new Date().toISOString().slice(0, 10)}.json`, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'LønKontrol backup' });
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click(); }
  } catch {}
};
$('#import').onchange = async (e) => {
  try {
    const data = JSON.parse(await e.target.files[0].text());
    if (data.app !== 'LønKontrol') throw new Error('forkert fil');
    if (data.settings) setSettings(data.settings);
    for (const s of data.slips || []) await db.put(s);
    toast(`Hentede ${(data.slips || []).length} lønsedler.`);
  } catch { toast('Det er ikke en LønKontrol-backup.'); }
  e.target.value = '';
};

// ---------- Filvalg + træk-og-slip (computer) ----------
$('#file').onchange = (e) => { handleFile(e.target.files[0]); e.target.value = ''; };
addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('drag'); });
addEventListener('dragleave', () => document.body.classList.remove('drag'));
addEventListener('drop', (e) => { e.preventDefault(); document.body.classList.remove('drag'); handleFile(e.dataTransfer.files[0]); });

// ---------- Installér ----------
let deferredPrompt = null;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); deferredPrompt = e;
  $('#install').hidden = false; $('#install-hint').hidden = false;
});
$('#install').onclick = async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null;
  $('#install').hidden = true; $('#install-hint').hidden = true;
};

// ---------- Router ----------
async function route() {
  const h = location.hash.slice(1);
  if (h.startsWith('slip/')) { const s = await db.get(h.slice(5)); return s ? renderResult(s) : renderHome(); }
  if (h.startsWith('edit/')) { current = current?.id === h.slice(5) ? current : await db.get(h.slice(5)); return renderEdit(); }
  if (h === 'settings') return renderSettings();
  return renderHome();
}
addEventListener('hashchange', route);

(async function init() {
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('sw.js'); } catch (e) { console.warn(e); }
  }
  const shared = new URLSearchParams(location.search).has('shared');
  if (shared) {
    history.replaceState(null, '', location.pathname + location.hash);
    if (await processShareInbox()) return;
  }
  route();
})();
