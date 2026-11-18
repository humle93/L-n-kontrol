// LønKontrol – udtræk af tal fra en dansk lønseddel (ren funktion, ingen DOM).
// Input: tekstlinjer (som pdf.js giver dem, samlet pr. linje). Output: felter + lønlinjer.

// Danske beløb: 1.234,56  -1.234,56  1.234,56-  1234,56  37,00 %
const AMOUNT_RE = /(-?)(\d{1,3}(?:\.\d{3})+|\d+),(\d{2})(-?)(?!\d)/g;

export function parseAmounts(line) {
  const out = [];
  for (const m of line.matchAll(AMOUNT_RE)) {
    const n = Number(m[2].replace(/\./g, '') + '.' + m[3]);
    const neg = m[1] === '-' || m[4] === '-';
    out.push({ value: neg ? -n : n, index: m.index });
  }
  return out;
}

export function parseNumberDa(s) {
  if (s == null || s === '') return null;
  const t = String(s).trim().replace(/\s/g, '');
  if (!t) return null;
  // Tillad både "1.234,56" og "1234.56"
  let norm;
  if (t.includes(',')) norm = t.replace(/\./g, '').replace(',', '.');
  else norm = t;
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}

// Fjern CPR-numre, så de aldrig gemmes eller vises.
export function stripCpr(text) {
  return text.replace(/\b\d{6}[- ]?\d{4}\b/g, '••••••-••••');
}

// Felter vi leder efter. "exclude" forhindrer forkerte match (fx AM-bidrag vs AM-grundlag).
const FIELDS = {
  amIndkomst: { re: /\bam[- ]?(indkomst|grundlag|bidragsgrundlag|bidragspligtig|-?bidragspligtig\s+løn)/i },
  amBidrag: { re: /\bam[- ]?bidrag\b|\barbejdsmarkedsbidrag/i, exclude: /grundlag|pligtig|indkomst/i },
  aSkat: { re: /\ba[- ]?skat\b/i, exclude: /grundlag|pligtig|indkomst|procent/i },
  fradrag: { re: /(måneds|periode|14[- ]?dages|skatte)?fradrag\b/i, exclude: /pension|fagforening|kantine/i },
  traek: { re: /træk[- ]?(procent|pct|%)|skatteprocent|træk\s*%/i },
  atp: { re: /\batp\b/i, exclude: /arbejdsgiver|firma/i },
  pensionEgen: { re: /(egen|eget|medarbejder|ansat)\w*[\s-]*(andel\s*)?pension|pension\w*[\s-]*(egen|eget|medarbejder|ansat)/i },
  pensionFirma: { re: /(firma|arbejdsgiver)\w*[\s-]*(andel\s*)?pension|pension\w*[\s-]*(firma|arbejdsgiver)/i },
  brutto: { re: /\bbrutto(løn|indkomst)?\b|\bløn i alt\b|\bbruttoløn\b/i, exclude: /time/i },
  netto: { re: /til udbetaling|udbetalt|nettoløn|\bnetto\b|overføres|beløb til konto|udbetales/i },
  feriepenge: { re: /feriepenge|feriegodtgørelse/i, exclude: /tillæg/i },
  ferietillaeg: { re: /ferietillæg/i },
  timer: { re: /timer i alt|arbejdstimer|løntimer|antal timer|normaltimer|ATP[- ]?timer/i },
};

const PERIOD_RE = /(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})\s*(?:-|–|til)\s*(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})/;
const MONTHS = ['januar','februar','marts','april','maj','juni','juli','august','september','oktober','november','december'];
const MONTH_RE = new RegExp(`\\b(${MONTHS.join('|')})\\s+(20\\d{2})\\b`, 'i');

function fullYear(y) { y = Number(y); return y < 100 ? 2000 + y : y; }

export function findPeriod(lines) {
  for (const l of lines) {
    const m = l.match(PERIOD_RE);
    if (m) {
      const from = `${fullYear(m[3])}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
      const to = `${fullYear(m[6])}-${String(m[5]).padStart(2, '0')}-${String(m[4]).padStart(2, '0')}`;
      return { from, to, key: to.slice(0, 7) };
    }
  }
  for (const l of lines) {
    const m = l.match(MONTH_RE);
    if (m) {
      const mm = MONTHS.indexOf(m[1].toLowerCase()) + 1;
      const key = `${m[2]}-${String(mm).padStart(2, '0')}`;
      return { from: null, to: null, key };
    }
  }
  return null;
}

function percentOnLine(line) {
  const m = line.match(/(\d{1,2}(?:,\d{1,2})?)\s*%/) || line.match(/(\d{1,2}(?:,\d{1,2})?)\s*$/);
  if (!m) return null;
  const v = parseNumberDa(m[1]);
  return v != null && v > 0 && v <= 70 ? v : null;
}

function labelPart(line) {
  const first = line.search(/\d/);
  return first === -1 ? line : line.slice(0, first);
}

// Lønlinjer: "Timeløn 160,33 225,50 36.154,42" -> antal × sats = beløb
export function findPayLines(lines) {
  const out = [];
  for (const l of lines) {
    const a = parseAmounts(l);
    if (a.length < 3) continue;
    const label = labelPart(l).trim();
    if (!label || label.length < 2) continue;
    // Prøv alle tripler i rækkefølge (antal, sats, beløb)
    for (let i = 0; i + 2 < a.length; i++) {
      const q = Math.abs(a[i].value), r = Math.abs(a[i + 1].value), t = Math.abs(a[i + 2].value);
      if (q === 0 || r === 0) continue;
      const calc = q * r;
      const rel = Math.abs(calc - t) / Math.max(t, 1);
      // Accepter som lønlinje hvis tæt på (≤ 5 %); markér afvigelse > 1 kr
      if (rel <= 0.05) {
        out.push({ label, antal: q, sats: r, beloeb: t, beregnet: Math.round(calc * 100) / 100 });
        break;
      }
    }
  }
  return out;
}

export function parsePayslip(rawLines) {
  const lines = rawLines.map((l) => stripCpr(l).replace(/\s+/g, ' ').trim()).filter(Boolean);
  const cand = {};
  for (const [name, def] of Object.entries(FIELDS)) cand[name] = [];

  for (const line of lines) {
    const label = labelPart(line);
    for (const [name, def] of Object.entries(FIELDS)) {
      if (!def.re.test(label)) continue;
      if (def.exclude && def.exclude.test(label)) continue;
      if (name === 'traek') {
        const p = percentOnLine(line);
        if (p != null) cand.traek.push([{ value: p }]);
        continue;
      }
      const a = parseAmounts(line.slice(label.length));
      if (a.length) cand[name].push(a);
    }
  }

  // Find kolonne (periode vs. år-til-dato) ud fra AM-par: AM-bidrag = 8 % af AM-indkomst.
  let colFromEnd = 0;
  let amInd = null, amBid = null;
  const ai = cand.amIndkomst[0], ab = cand.amBidrag[0];
  if (ai && ab) {
    let best = Infinity;
    for (let i = 0; i < ai.length; i++) {
      for (let j = 0; j < ab.length; j++) {
        const x = Math.abs(ai[i].value), y = Math.abs(ab[j].value);
        const err = Math.abs(x * 0.08 - y);
        // Foretræk periodetal (mindste) ved lige god fit
        const score = err + x * 1e-9;
        if (score < best) { best = score; amInd = x; amBid = y; colFromEnd = ab.length - 1 - j; }
      }
    }
  }

  const pick = (name) => {
    const arr = cand[name][0];
    if (!arr || !arr.length) return null;
    const idx = Math.max(0, arr.length - 1 - colFromEnd);
    return Math.abs(arr[Math.min(idx, arr.length - 1)].value);
  };

  const fields = {
    amIndkomst: amInd ?? pick('amIndkomst'),
    amBidrag: amBid ?? pick('amBidrag'),
    aSkat: pick('aSkat'),
    fradrag: pick('fradrag'),
    traek: cand.traek[0] ? cand.traek[0][0].value : null,
    atp: pick('atp'),
    pensionEgen: pick('pensionEgen'),
    pensionFirma: pick('pensionFirma'),
    brutto: pick('brutto'),
    netto: pick('netto'),
    feriepenge: pick('feriepenge'),
    ferietillaeg: pick('ferietillaeg'),
    timer: pick('timer'),
  };

  return {
    fields,
    period: findPeriod(lines),
    payLines: findPayLines(lines),
    found: Object.entries(fields).filter(([, v]) => v != null).map(([k]) => k),
  };
}
