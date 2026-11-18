import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePayslip, parseAmounts, stripCpr, parseNumberDa } from '../js/parse.js';
import { runChecks } from '../js/checks.js';
import { VERSION } from '../js/version.js';

// Typisk lønseddel med periode- og år-til-dato-kolonne
const SLIP_YTD = [
  'Lønspecifikation  Henning Amundsen  CPR 010190-1234',
  'Lønperiode 01.11.2026 - 30.11.2026',
  'Lønart Antal Sats Beløb År til dato',
  'Timeløn 160,33 160,00 25.652,80 51.305,60',
  'Pension egen andel 4% 1.026,11- 2.052,22-',
  'Pension firma andel 2.052,22 4.104,44',
  'AM-indkomst 24.626,69 49.253,38',
  'AM-bidrag 1.970,00- 3.940,00-',
  'Trækprocent 37 %',
  'Månedsfradrag 4.950,00 9.900,00',
  'A-skat 6.551,00- 13.102,00-',
  'ATP 99,00- 198,00-',
  'Til udbetaling 16.006,69',
];

const SETTINGS = { periode: 'maaned', startTimeloen: 160, startMaaned: '2026-10' };

test('tal i dansk format', () => {
  assert.deepEqual(parseAmounts('x 1.234,56- 7,00 -12,50').map((a) => a.value), [-1234.56, 7, -12.5]);
  assert.equal(parseNumberDa('4.950,00'), 4950);
  assert.equal(parseNumberDa('170'), 170);
  assert.equal(parseNumberDa(''), null);
});

test('CPR fjernes', () => {
  assert.ok(!stripCpr('CPR 010190-1234').includes('1234'));
});

test('lønseddel med år-til-dato læses rigtigt', () => {
  const p = parsePayslip(SLIP_YTD);
  assert.equal(p.fields.amIndkomst, 24626.69);
  assert.equal(p.fields.amBidrag, 1970);
  assert.equal(p.fields.aSkat, 6551);
  assert.equal(p.fields.traek, 37);
  assert.equal(p.fields.fradrag, 4950);
  assert.equal(p.fields.atp, 99);
  assert.equal(p.fields.pensionEgen, 1026.11);
  assert.equal(p.fields.pensionFirma, 2052.22);
  assert.equal(p.fields.netto, 16006.69);
  assert.equal(p.period.key, '2026-11');
  assert.equal(p.payLines.length, 1);
  assert.equal(p.payLines[0].sats, 160);
});

test('korrekt lønseddel uden lønstigningskrav giver ingen fejl i skat', () => {
  const p = parsePayslip(SLIP_YTD);
  const r = runChecks(p, { periode: 'maaned' });
  const byId = Object.fromEntries(r.checks.map((c) => [c.id, c.status]));
  assert.equal(byId.am, 'ok');
  assert.equal(byId.askat, 'ok');
  assert.equal(byId.atp, 'ok');
  assert.equal(byId.linjer, 'ok');
  assert.equal(r.rate, 160);
});

test('manglende lønstigning fanges (160 kr måneden efter start)', () => {
  const r = runChecks(parsePayslip(SLIP_YTD), SETTINGS);
  const c = r.checks.find((x) => x.id === 'timeloen');
  assert.equal(c.status, 'fail');
  assert.match(c.title, /lønstigning/i);
  assert.equal(r.overall, 'fail');
});

test('ny timeløn angivet men ikke udbetalt', () => {
  const r = runChecks(parsePayslip(SLIP_YTD), { ...SETTINGS, nyTimeloen: 170 });
  assert.equal(r.checks.find((x) => x.id === 'timeloen').title, 'Lønstigningen mangler');
});

test('lønstigning med -> ok', () => {
  const lines = SLIP_YTD.map((l) => l.startsWith('Timeløn') ? 'Timeløn 160,33 170,00 27.256,10' : l);
  const r = runChecks(parsePayslip(lines), { ...SETTINGS, nyTimeloen: 170 });
  assert.equal(r.checks.find((x) => x.id === 'timeloen').status, 'info');
});

test('forkert AM-bidrag og forkert trækprocent fanges', () => {
  const lines = SLIP_YTD.map((l) => l.startsWith('AM-bidrag') ? 'AM-bidrag 2.100,00-' : l);
  const r = runChecks(parsePayslip(lines), { periode: 'maaned', traek: 36 });
  const byId = Object.fromEntries(r.checks.map((c) => [c.id, c.status]));
  assert.equal(byId.am, 'fail');
  assert.equal(byId.skattekort, 'fail');
});

test('lønlinje der regner forkert fanges', () => {
  const lines = [...SLIP_YTD, 'Overtid 50% 10,00 240,00 2.500,00'];
  const r = runChecks(parsePayslip(lines), { periode: 'maaned' });
  assert.equal(r.checks.find((x) => x.id === 'linjer').status, 'fail');
});

test('ATP ved 14-dages løn', () => {
  const lines = SLIP_YTD.map((l) => l.startsWith('ATP') ? 'ATP 52,20-' : l);
  const r = runChecks(parsePayslip(lines), { periode: '14dage' });
  assert.equal(r.checks.find((x) => x.id === 'atp').status, 'ok');
});

test('versionsnumre er ens', () => {
  assert.equal(readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim(), VERSION);
  assert.match(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), new RegExp(`VERSION = '${VERSION.replace(/\./g, '\\.')}'`));
  const m = JSON.parse(readFileSync(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(m.share_target.method, 'POST');
});
