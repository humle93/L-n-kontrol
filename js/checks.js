// LønKontrol – kontroller (rene funktioner). Status: ok | warn | fail | info

export const AM_RATE = 0.08;

// ATP A-sats 2026, lønmodtagerens andel (kilde: virk.dk / borger.dk)
export const ATP_2026 = {
  maaned: [ { min: 117, v: 99 }, { min: 78, v: 66 }, { min: 39, v: 33 }, { min: 0, v: 0 } ],
  '14dage': [ { min: 54, v: 52.2 }, { min: 36, v: 34.8 }, { min: 18, v: 17.4 }, { min: 0, v: 0 } ],
};

const kr = (n) => n == null ? '–' : n.toLocaleString('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kr';
const r2 = (n) => Math.round(n * 100) / 100;

const BASE_RATE_LABEL = /time\s*løn|timeløn|normaltimer|grundløn|ordinær|almindelig/i;

export function baseHourlyRate(payLines) {
  const cands = payLines.filter((p) => p.sats >= 100 && p.sats <= 600);
  const labelled = cands.filter((p) => BASE_RATE_LABEL.test(p.label));
  const pool = labelled.length ? labelled : cands;
  if (!pool.length) return null;
  // Linjen med flest timer er normalt grundlønnen
  return pool.reduce((a, b) => (b.antal > a.antal ? b : a)).sats;
}

function monthsBetween(fromKey, toKey) {
  const [fy, fm] = fromKey.split('-').map(Number);
  const [ty, tm] = toKey.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

export function runChecks(slip, settings = {}, previous = null) {
  const f = slip.fields;
  const out = [];
  const add = (id, status, title, detail) => out.push({ id, status, title, detail });

  // 1. AM-bidrag
  if (f.amIndkomst != null && f.amBidrag != null) {
    const exp = Math.round(f.amIndkomst * AM_RATE);
    const diff = r2(f.amBidrag - exp);
    if (Math.abs(diff) <= 1) add('am', 'ok', 'AM-bidrag er korrekt', `8 % af ${kr(f.amIndkomst)} = ${kr(exp)}`);
    else add('am', 'fail', 'AM-bidrag passer ikke', `Forventet ${kr(exp)} (8 % af ${kr(f.amIndkomst)}), trukket ${kr(f.amBidrag)}. Forskel ${kr(diff)}.`);
  } else {
    add('am', 'warn', 'AM-bidrag kunne ikke tjekkes', 'Fandt ikke både AM-indkomst og AM-bidrag. Ret tallene under "Ret tal".');
  }

  // 2. A-skat
  if (f.amIndkomst != null && f.amBidrag != null && f.aSkat != null && f.traek != null) {
    const fradrag = f.fradrag ?? 0;
    const grundlag = Math.max(0, f.amIndkomst - f.amBidrag - fradrag);
    const exp = Math.floor(grundlag * f.traek / 100);
    const diff = r2(f.aSkat - exp);
    const detail = `(${kr(f.amIndkomst)} − ${kr(f.amBidrag)} − fradrag ${kr(fradrag)}) × ${f.traek} % = ${kr(exp)}, trukket ${kr(f.aSkat)}.`;
    if (Math.abs(diff) <= 2) add('askat', 'ok', 'A-skat er korrekt', detail);
    else if (Math.abs(diff) <= Math.max(25, exp * 0.01)) add('askat', 'warn', 'A-skat afviger lidt', detail + ` Forskel ${kr(diff)} – kan skyldes afrunding eller skattepligtige personalegoder.`);
    else add('askat', 'fail', 'A-skat passer ikke', detail + ` Forskel ${kr(diff)}.` + (f.fradrag == null ? ' Fradrag blev ikke fundet – tjek det.' : ''));
  } else {
    add('askat', 'warn', 'A-skat kunne ikke tjekkes', 'Mangler A-skat, trækprocent eller AM-tal.');
  }

  // 3. Skattekort vs. forskudsopgørelse
  if (settings.traek && f.traek != null && Math.abs(settings.traek - f.traek) > 0.01) {
    add('skattekort', 'fail', 'Forkert trækprocent', `Lønsedlen bruger ${f.traek} %, men din forskudsopgørelse siger ${settings.traek} %.`);
  }
  if (settings.fradrag && f.fradrag != null && Math.abs(settings.fradrag - f.fradrag) > 1) {
    add('skattekort', 'fail', 'Forkert fradrag', `Lønsedlen bruger ${kr(f.fradrag)}, men forskudsopgørelsen siger ${kr(settings.fradrag)}.`);
  }
  if (f.traek != null && (f.traek < 8 || f.traek > 60)) {
    add('traekrimelig', 'warn', 'Usædvanlig trækprocent', `${f.traek} % – tjek dit skattekort på skat.dk.`);
  }

  // 4. ATP
  if (f.atp != null) {
    const table = ATP_2026[settings.periode === '14dage' ? '14dage' : 'maaned'];
    const valid = table.map((t) => t.v);
    if (f.timer != null) {
      const exp = table.find((t) => f.timer >= t.min).v;
      if (Math.abs(f.atp - exp) <= 0.01) add('atp', 'ok', 'ATP er korrekt', `${f.timer} timer → ${kr(exp)}`);
      else add('atp', 'fail', 'ATP passer ikke', `Ved ${f.timer} timer skal din andel være ${kr(exp)}, trukket ${kr(f.atp)}.`);
    } else if (valid.some((v) => Math.abs(v - f.atp) <= 0.01)) {
      add('atp', 'ok', 'ATP-beløb er en gyldig sats', kr(f.atp));
    } else {
      add('atp', 'warn', 'ATP-beløb er ikke en standardsats', `${kr(f.atp)} – gyldige satser: ${valid.map(kr).join(', ')}.`);
    }
  }

  // 5. Lønlinjer: antal × sats = beløb
  const bad = slip.payLines.filter((p) => Math.abs(p.beregnet - p.beloeb) > 1);
  if (slip.payLines.length) {
    if (bad.length) add('linjer', 'fail', `${bad.length} lønlinje(r) regner forkert`, bad.map((p) => `${p.label}: ${p.antal} × ${kr(p.sats)} = ${kr(p.beregnet)}, men står ${kr(p.beloeb)}`).join('\n'));
    else add('linjer', 'ok', slip.payLines.length === 1 ? 'Lønlinjen regner rigtigt' : `Alle ${slip.payLines.length} lønlinjer regner rigtigt`, 'Antal × sats = beløb');
  }

  // 6. Timeløn og lønstigning
  const rate = baseHourlyRate(slip.payLines);
  if (rate != null) {
    const start = settings.startTimeloen;
    const ny = settings.nyTimeloen;
    const monthsIn = settings.startMaaned && slip.period?.key ? monthsBetween(settings.startMaaned, slip.period.key) : null;
    if (ny && monthsIn != null && monthsIn >= 1 && rate < ny - 0.005) {
      add('timeloen', 'fail', 'Lønstigningen mangler', `Timeløn ${kr(rate)}, men den skulle være ${kr(ny)} fra måneden efter start.`);
    } else if (!ny && start && monthsIn != null && monthsIn >= 1 && Math.abs(rate - start) < 0.005) {
      add('timeloen', 'fail', 'Ingen lønstigning endnu', `Timelønnen er stadig ${kr(rate)} – ${monthsIn} ${monthsIn === 1 ? 'måned' : 'måneder'} efter start. Du skulle have haft lønforhøjelse.`);
    } else if (start && rate < start - 0.005) {
      add('timeloen', 'fail', 'Timeløn er lavere end aftalt', `${kr(rate)} mod aftalt ${kr(start)}.`);
    } else {
      add('timeloen', 'info', `Timeløn: ${kr(rate)}`, ny && rate >= ny ? 'Lønstigningen er med.' : '');
    }
    if (previous?.rate && rate < previous.rate - 0.005) {
      add('timeloenfald', 'fail', 'Timelønnen er faldet', `Fra ${kr(previous.rate)} til ${kr(rate)} siden sidste lønseddel.`);
    }
  }

  // 7. Udbetaling – grov kontrol
  if (f.netto != null && f.amIndkomst != null && f.amBidrag != null && f.aSkat != null) {
    const exp = f.amIndkomst - f.amBidrag - f.aSkat - (f.atp ?? 0);
    const diff = r2(f.netto - exp);
    add('netto', 'info', `Udbetalt ${kr(f.netto)}`, Math.abs(diff) < 1 ? 'Passer præcist med løn minus skat.' : `Forskel på ${kr(diff)} i forhold til løn − AM − A-skat − ATP. Det er normalt andre træk eller tillæg (fx fagforening, kantine, skattefri godtgørelse).`);
  }

  // 8. Sammenligning med sidste lønseddel
  if (previous?.fields) {
    const p = previous.fields;
    if (p.traek != null && f.traek != null && p.traek !== f.traek) add('mdr-traek', 'warn', 'Trækprocenten er ændret', `Fra ${p.traek} % til ${f.traek} %. Har du ændret forskudsopgørelsen?`);
    if (p.fradrag != null && f.fradrag != null && Math.abs(p.fradrag - f.fradrag) > 1) add('mdr-fradrag', 'warn', 'Fradraget er ændret', `Fra ${kr(p.fradrag)} til ${kr(f.fradrag)}.`);
    if (p.netto && f.netto && f.netto < p.netto * 0.85) add('mdr-netto', 'warn', 'Udbetalingen er faldet markant', `Fra ${kr(p.netto)} til ${kr(f.netto)}.`);
  }

  const order = { fail: 0, warn: 1, ok: 2, info: 3 };
  out.sort((a, b) => order[a.status] - order[b.status]);
  const overall = out.some((c) => c.status === 'fail') ? 'fail' : out.some((c) => c.status === 'warn') ? 'warn' : 'ok';
  return { checks: out, overall, rate };
}
