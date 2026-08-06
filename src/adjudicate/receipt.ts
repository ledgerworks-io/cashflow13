/**
 * La ricevuta dell'aggiudicatore.
 *
 * Valgono le stesse quattro regole della cartella del piano di cassa
 * (DIARIO §6): nessun valore in cache accanto alle formule, formule senza `=`,
 * `fullCalcOnLoad`, formati numerici espliciti.
 *
 * Ma c'è una cosa in più, ed è il prodotto: **i totali in testa sono formule
 * che contano i verdetti riga per riga.** Il cliente non deve credere ai nostri
 * numeri — li vede derivare dai singoli verdetti e può rifare il conto. Se
 * qualcuno un giorno li "ottimizza" scrivendoli come numeri fissi, la ricevuta
 * smette di essere una prova e torna a essere un'affermazione: ci sono dei test
 * apposta per impedirlo.
 */
import ExcelJS from "exceljs";

import { t, type Locale } from "../i18n/index.js";
import { describeRule } from "../audit/receipt.js";
import type { BillingPolicy } from "./billing.js";
import type { Adjudication, Reason, Verdict, Warning } from "./verdict.js";

export { XLSX_MIME } from "../audit/receipt.js";

const GIALLO = "FFFFF3C4";
const GRIGIO = "FFF2F2F2";
const ROSSO = "FFFCE8E6";
const VERDE = "FFE6F4EA";

/** Etichetta tradotta di un verdetto. Il motore emette codici, mai frasi. */
export function verdictLabel(v: Verdict, loc: Locale): string {
  switch (v) {
    case "good":
      return t("verdict.good", loc);
    case "rejected":
      return t("verdict.rejected", loc);
    case "duplicate":
      return t("verdict.duplicate", loc);
    case "undecidable":
      return t("verdict.undecidable", loc);
  }
}

/**
 * Una ragione, scritta per chi legge. I numeri di riga escono contati da 1:
 * il cliente non deve fare aritmetica sulla nostra convenzione interna.
 */
export function describeReason(reason: Reason, loc: Locale): string {
  switch (reason.code) {
    case "duplicate":
      return `${t("reason.duplicate", loc)} (${reason.firstSeenAt + 1})`;
    case "empty":
      return `${reason.field} — ${t("reason.empty", loc)}`;
    case "filter":
      return `${describeRule(reason.rule)} — ${t("reason.filter", loc)}`;
    case "email":
      return `${reason.field} — ${reason.detail}`;
  }
}

function describeWarning(w: Warning, loc: Locale): string {
  return `${w.field} — ${w.detail} (${t("warning.email", loc)})`;
}

/**
 * Un riferimento a foglio dentro una formula. I nomi con spazi o accenti vanno
 * fra apici singoli, altrimenti Excel apre il file dicendo che è «da riparare».
 */
function sheetRef(name: string): string {
  return /^[A-Za-z0-9_]+$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

export interface VerdictReceiptOptions {
  amountPaidUsd?: number | undefined;
  locale?: Locale | undefined;
  /** Solo etichetta, per sapere di che esecuzione si parla. */
  source?: string | undefined;
  /**
   * La politica applicata. Se c'è, la ricevuta mostra **quanto si paga** e non
   * solo quanti record sono stati addebitati — compreso il tetto, come formula
   * viva sopra la cella dell'importo pagato. Senza questo blocco la promessa
   * centrale del prodotto resterebbe invisibile proprio nel documento che
   * dovrebbe dimostrarla.
   */
  policy?: BillingPolicy | undefined;
}

export async function generateVerdictReceipt(
  adjudication: Adjudication,
  options: VerdictReceiptOptions = {},
): Promise<Buffer> {
  const loc = options.locale ?? "en";
  const { records } = adjudication;

  const wb = new ExcelJS.Workbook();
  wb.creator = "ledgerworks — adjudicator";
  wb.calcProperties.fullCalcOnLoad = true;

  const nomeVerdetti = t("adj.sheet.verdicts", loc);
  const rif = sheetRef(nomeVerdetti);
  // Con zero record il foglio non ha righe di dati: si tiene comunque un
  // intervallo valido (riga 2) così le formule restano formule e danno 0.
  const ultima = Math.max(2, records.length + 1);
  const colonna = (c: string) => `${rif}!$${c}$2:$${c}$${ultima}`;
  const conta = (c: string, etichetta: string) =>
    `COUNTIF(${colonna(c)},"${etichetta}")`;

  // --- Ricevuta ---------------------------------------------------------
  const ws = wb.addWorksheet(t("audit.sheet.receipt", loc));
  ws.getColumn(1).width = 46;
  ws.getColumn(2).width = 18;

  ws.getCell("A1").value = t("audit.title", loc);
  ws.getCell("A1").font = { bold: true, size: 16 };
  if (options.source) {
    ws.getCell("A2").value = options.source;
    ws.getCell("A2").font = { italic: true, size: 10 };
  }
  ws.getCell("A3").value = t("audit.input_note", loc);
  ws.getCell("A3").font = { bold: true };

  ws.getCell("A5").value = t("audit.paid", loc);
  const pagato = ws.getCell("B5");
  pagato.value = options.amountPaidUsd ?? 0;
  pagato.numFmt = "#,##0.00000";
  pagato.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GIALLO } };

  // Tutti i conteggi contano dai verdetti: nessun numero affermato.
  const conteggi: [string, string][] = [
    [t("audit.delivered", loc), `COUNTA(${colonna("A")})`],
    [t("audit.good", loc), conta("B", verdictLabel("good", loc))],
    [t("adj.rejected", loc), conta("B", verdictLabel("rejected", loc))],
    [t("audit.duplicates", loc), conta("B", verdictLabel("duplicate", loc))],
    [t("adj.undecidable", loc), conta("B", verdictLabel("undecidable", loc))],
  ];
  conteggi.forEach(([etichetta, formula], i) => {
    const r = 6 + i;
    ws.getCell(`A${r}`).value = etichetta;
    const c = ws.getCell(`B${r}`);
    c.value = { formula };
    c.numFmt = "#,##0";
  });

  ws.getCell("A12").value = t("adjudicate.billable", loc);
  ws.getCell("B12").value = { formula: conta("C", t("adj.charged.yes", loc)) };
  ws.getCell("B12").numFmt = "#,##0";

  ws.getCell("A13").value = t("adjudicate.not_billable", loc);
  const nonAddebitati = ws.getCell("B13");
  nonAddebitati.value = { formula: conta("C", t("adj.charged.no", loc)) };
  nonAddebitati.numFmt = "#,##0";
  nonAddebitati.fill = { type: "pattern", pattern: "solid", fgColor: { argb: VERDE } };

  ws.getCell("A15").value = t("audit.cost_delivered", loc);
  ws.getCell("B15").value = { formula: 'IF(B6=0,"",B5/B6)' };
  ws.getCell("B15").numFmt = "#,##0.00000";

  ws.getCell("A16").value = t("audit.cost_good", loc);
  const costoUtile = ws.getCell("B16");
  costoUtile.value = { formula: 'IF(B7=0,"",B5/B7)' };
  costoUtile.numFmt = "#,##0.00000";
  costoUtile.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ROSSO } };
  costoUtile.font = { bold: true };

  ws.getCell("A17").value = t("audit.ratio", loc);
  ws.getCell("B17").value = { formula: 'IF(OR(B7=0,B6=0),"",(B5/B7)/(B5/B6))' };
  ws.getCell("B17").numFmt = "#,##0.00";

  // La garanzia sta nella ricevuta, non solo nella scheda del prodotto: è lì
  // che il cliente la verifica, riga per riga, contro la colonna «Addebito».
  ws.getCell("A19").value = t("adjudicate.guarantee", loc);
  ws.getCell("A19").font = { bold: true };
  ws.getCell("A20").value = t("audit.scope", loc);
  ws.getCell("A20").font = { italic: true, size: 10 };
  if (options.amountPaidUsd === undefined) {
    ws.getCell("A21").value = t("audit.no_price", loc);
    ws.getCell("A21").font = { italic: true };
  }

  // --- Quanto costa, come formula viva -----------------------------------
  // Tutto discende da B12 (aggiudicati, che a sua volta conta i verdetti) e da
  // B5 (l'importo pagato, cella di input). Il cliente cambia B5 e vede muoversi
  // il tetto e il totale: la promessa si verifica invece di essere creduta.
  if (options.policy) {
    const p = options.policy;
    ws.getCell("A23").value = t("adj.billing.header", loc);
    ws.getCell("A23").font = { bold: true, size: 12 };

    ws.getCell("A24").value = t("adj.billing.free", loc);
    ws.getCell("B24").value = p.freePerRun;
    ws.getCell("B24").numFmt = "#,##0";

    ws.getCell("A25").value = t("adj.billing.charged_count", loc);
    ws.getCell("B25").value = { formula: "MAX(0,B12-B24)" };
    ws.getCell("B25").numFmt = "#,##0";

    ws.getCell("A26").value = t("adj.billing.price", loc);
    ws.getCell("B26").value = p.pricePerRecordUsd;
    ws.getCell("B26").numFmt = "#,##0.00000";

    // Il tetto discende dai record CONSEGNATI (B6, che a sua volta li conta),
    // non da quanto il cliente ha dichiarato di aver speso. Quindi c'è sempre,
    // anche quando l'importo pagato non è stato indicato — ed è verificabile
    // con una divisione invece che sulla fiducia.
    // L'etichetta prende la tariffa dalla politica applicata: se un giorno il
    // listino cambia, la riga che lo dichiara cambia con lui. La virgola
    // decimale segue la lingua, come tutto il resto del foglio.
    const tariffa = p.capUsdPer1000Delivered.toFixed(2);
    ws.getCell("A27").value = t("adj.billing.cap", loc)
      .replace("{n}", loc === "it" ? tariffa.replace(".", ",") : tariffa);
    ws.getCell("B27").value = { formula: `B6/1000*${p.capUsdPer1000Delivered}` };
    ws.getCell("B27").numFmt = "#,##0.00000";

    ws.getCell("A28").value = t("adj.billing.total", loc);
    const totale = ws.getCell("B28");
    totale.value = { formula: "MIN(B25*B26,B27)" };
    totale.numFmt = "#,##0.00000";
    totale.font = { bold: true };
    totale.fill = { type: "pattern", pattern: "solid", fgColor: { argb: VERDE } };
  }

  // --- Verdetti ----------------------------------------------------------
  const wv = wb.addWorksheet(nomeVerdetti);
  wv.getColumn(1).width = 16;
  wv.getColumn(2).width = 18;
  wv.getColumn(3).width = 16;
  wv.getColumn(4).width = 60;
  wv.getColumn(5).width = 46;

  if (records.length === 0) {
    wv.getCell("A1").value = t("audit.none", loc);
    wv.getCell("A1").font = { italic: true };
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  const intestazioni = [
    t("adj.col.row", loc),
    t("adj.col.verdict", loc),
    t("adj.col.billing", loc),
    t("adj.col.why", loc),
    t("adj.col.note", loc),
  ];
  intestazioni.forEach((h, i) => {
    const c = wv.getCell(1, i + 1);
    c.value = h;
    c.font = { bold: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRIGIO } };
  });

  records.forEach((rec, i) => {
    const r = i + 2;
    const posizione = wv.getCell(r, 1);
    posizione.value = rec.index + 1; // il file del cliente comincia da 1
    posizione.numFmt = "#,##0";
    wv.getCell(r, 2).value = verdictLabel(rec.verdict, loc);
    wv.getCell(r, 3).value = rec.billable
      ? t("adj.charged.yes", loc)
      : t("adj.charged.no", loc);
    wv.getCell(r, 4).value =
      rec.reasons.length > 0 ? rec.reasons.map((x) => describeReason(x, loc)).join("; ") : null;
    wv.getCell(r, 5).value =
      rec.warnings.length > 0
        ? rec.warnings.map((x) => describeWarning(x, loc)).join("; ")
        : rec.verdict === "undecidable"
          ? t("adjudicate.undecidable_note", loc)
          : null;
  });

  wv.autoFilter = { from: { row: 1, column: 1 }, to: { row: records.length + 1, column: 5 } };

  return Buffer.from(await wb.xlsx.writeBuffer());
}
