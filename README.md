# LønKontrol

Tjek din lønseddel automatisk – direkte fra mobilen. **Del lønsedlen fra e-Boks → LønKontrol**, og du får svar på få sekunder.

**Åbn appen:** https://humle93.github.io/L-n-kontrol/

## Kom i gang (én gang, ca. 30 sek.)
1. Åbn linket ovenfor i **Chrome** på telefonen.
2. Tryk **📲 Installér appen** (eller ⋮ → *Installér app*).
3. Færdig. Nu står *LønKontrol* i Del-menuen.

## Brug
- **e-Boks:** Åbn lønsedlen → **Del** → **LønKontrol**. Resultatet vises med det samme.
- **Computer:** Åbn linket og træk PDF'en ind på siden.

## Hvad tjekkes?
| Tjek | Hvordan |
|---|---|
| AM-bidrag | 8 % af AM-indkomst |
| A-skat | (AM-indkomst − AM-bidrag − fradrag) × trækprocent |
| Skattekort | Trækprocent og fradrag mod din forskudsopgørelse (hvis udfyldt) |
| ATP | Din andel mod 2026-satserne (måned / 14 dage) |
| Lønlinjer | Antal × sats = beløb på hver linje |
| Timeløn / lønstigning | Fanger hvis timelønnen stadig er startlønnen efter første måned, eller er lavere end aftalt |
| Måned til måned | Ændret trækprocent, fradrag, faldende timeløn eller udbetaling |

## Privatliv
Alt sker på telefonen. PDF'en gemmes ikke, CPR-nummeret fjernes, og intet sendes til en server. Kun tallene gemmes lokalt (backup via *Indstillinger → Del backup*).

## Udvikling
`npm test` kører tests. Push til `main` udruller automatisk til GitHub Pages. Version står i `VERSION`, `js/version.js` og `sw.js` (testen sikrer de er ens).
