/**
 * La cartella Excel viva.
 *
 * Il differenziale del prodotto: esistono decine di server MCP per Excel, sanno
 * scrivere una cella, nessuno sa cos'e' un rendiconto finanziario. Gli altri
 * danno la risposta in chat, qui si consegna il modello che funziona.
 *
 * Due regole non negoziabili, verificate in Excel il 2026-08-05:
 *  - nessun valore in cache accanto alle formule, e ricalcolo forzato
 *    all'apertura. Scrivere i risultati insieme alle formule farebbe vedere
 *    numeri vecchi finche' l'utente non tocca una cella: sembrerebbe viva e
 *    non lo sarebbe.
 *  - le celle gialle sono INPUT, tutto il resto e' formula. Chi riceve il file
 *    puo' cambiare un numero e vedere muoversi il piano, che e' il motivo per
 *    cui vuole un file invece di una risposta in chat.
 */
import ExcelJS from "exceljs";

import type { CashFlowPlan } from "../engine/plan.js";

export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const GIALLO = "FFFFF3C4"; // input
const GRIGIO = "FFF2F2F2"; // intestazioni
const ROSSO = "FFFCE8E6"; // le risposte, e le settimane sotto zero
const VERDE = "FFEAF6EC";

const iso = (d: Date): string => d.toISOString().slice(0, 10);

export interface WorkbookOptions {
  /** Sola etichetta: non si converte niente. */
  currency?: string;
}

export async function generateWorkbook(
  plan: CashFlowPlan,
  options: WorkbookOptions = {},
): Promise<Buffer> {
  const currency = options.currency ?? "EUR";

  const wb = new ExcelJS.Workbook();
  wb.creator = "ledgerworks — cashflow13";
  wb.calcProperties.fullCalcOnLoad = true;

  const ws = wb.addWorksheet("13-Week Cash Flow");
  const w1 = plan.weeks[0];
  const w13 = plan.weeks[plan.weeks.length - 1];
  if (!w1 || !w13) throw new Error("piano senza settimane");

  ws.getCell("A1").value = "13-Week Cash Flow Plan";
  ws.getCell("A1").font = { bold: true, size: 16 };
  // La convenzione va scritta nel file: chi lo riceve deve sapere cosa sta
  // guardando senza doverlo chiedere a chi gliel'ha mandato.
  ws.getCell("A2").value =
    `Weeks end on ${plan.weekEndsOn} · Week 1 ends ${iso(w1.weekEnding)}` +
    ` · Week 13 ends ${iso(w13.weekEnding)} · All figures in ${currency}`;
  ws.getCell("A2").font = { italic: true, color: { argb: "FF666666" } };

  ws.getCell("A4").value =
    "Yellow cells are inputs — change any of them and the whole plan recalculates.";
  ws.getCell("A4").font = { bold: true };

  ws.getCell("A5").value = "Opening cash balance";
  const apertura = ws.getCell("B5");
  apertura.value = w1.opening;
  apertura.numFmt = "#,##0";
  apertura.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GIALLO } };
  apertura.border = {
    top: { style: "thin" }, left: { style: "thin" },
    bottom: { style: "thin" }, right: { style: "thin" },
  };

  const R0 = 7;
  const intestazioni = [
    "Week", "Week ending", "Opening", "Receipts", "Suppliers",
    "Payroll", "Loans", "VAT / Tax", "Net movement", "Closing",
  ];
  intestazioni.forEach((h, i) => {
    const c = ws.getRow(R0).getCell(i + 1);
    c.value = h;
    c.font = { bold: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRIGIO } };
    c.border = { bottom: { style: "medium" } };
  });

  const PRIMA = R0 + 1;
  const ULTIMA = R0 + plan.weeks.length;

  plan.weeks.forEach((w, i) => {
    const r = PRIMA + i;
    const row = ws.getRow(r);
    row.getCell(1).value = w.week;
    row.getCell(2).value = w.weekEnding;
    row.getCell(2).numFmt = "yyyy-mm-dd";

    // Apertura: la prima prende la cella del saldo iniziale, le altre la
    // chiusura di sopra. E' la catena che rende vivo tutto il resto.
    row.getCell(3).value = { formula: i === 0 ? "$B$5" : `J${r - 1}` };

    // I cinque flussi sono INPUT: ogni settimana e' modificabile a mano.
    // Un piano di cassa reale non ha lo stesso incasso per tredici settimane,
    // e chi lo usa deve poter correggere la singola settimana.
    const flussi = [
      w.receipts, w.supplierPayments, w.payroll, w.loanRepayments, w.taxes,
    ];
    flussi.forEach((v, k) => {
      const c = row.getCell(4 + k);
      c.value = v;
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GIALLO } };
    });

    row.getCell(9).value = { formula: `D${r}-E${r}-F${r}-G${r}-H${r}` };
    row.getCell(10).value = { formula: `C${r}+I${r}` };

    for (let c = 3; c <= 10; c++) row.getCell(c).numFmt = "#,##0";
    row.getCell(10).font = { bold: true };
    // Verde di base; il rosso arriva dalla regola condizionale qui sotto, che
    // ha la precedenza quando il saldo scende sotto zero.
    row.getCell(10).fill = {
      type: "pattern", pattern: "solid", fgColor: { argb: VERDE },
    };
  });

  // La settimana sotto zero si deve vedere a colpo d'occhio: e' la riga che
  // l'utente sta cercando. Formattazione condizionale, non colore fisso, cosi'
  // segue i numeri quando lui li cambia.
  ws.addConditionalFormatting({
    ref: `J${PRIMA}:J${ULTIMA}`,
    rules: [
      {
        type: "cellIs", operator: "lessThan", formulae: ["0"], priority: 1,
        style: {
          fill: { type: "pattern", pattern: "solid", fgColor: { argb: ROSSO } },
          font: { bold: true, color: { argb: "FFB00020" } },
        },
      },
    ],
  });

  const K = ULTIMA + 2;
  ws.getCell(`A${K}`).value = "THE ANSWER";
  ws.getCell(`A${K}`).font = { bold: true, size: 13 };

  const risposte: Array<[string, string]> = [
    ["First week cash goes negative",
     `IFERROR(MATCH(TRUE,INDEX($J$${PRIMA}:$J$${ULTIMA}<0,0),0),"never — stays positive")`],
    ["Date of that week",
     `IFERROR(INDEX($B$${PRIMA}:$B$${ULTIMA},MATCH(TRUE,INDEX($J$${PRIMA}:$J$${ULTIMA}<0,0),0)),"—")`],
    ["Shortfall in that week",
     `IFERROR(INDEX($J$${PRIMA}:$J$${ULTIMA},MATCH(TRUE,INDEX($J$${PRIMA}:$J$${ULTIMA}<0,0),0)),0)`],
    // Il picco cumulato, NON lo scoperto della prima settimana negativa: la
    // cassa puo' risalire e poi sprofondare piu' giu'.
    ["Peak funding need over 13 weeks",
     `IF(MIN($J$${PRIMA}:$J$${ULTIMA})<0,-MIN($J$${PRIMA}:$J$${ULTIMA}),0)`],
    ["Lowest closing balance", `MIN($J$${PRIMA}:$J$${ULTIMA})`],
  ];
  risposte.forEach(([etichetta, formula], i) => {
    const r = K + 1 + i;
    ws.getCell(`A${r}`).value = etichetta;
    const c = ws.getCell(`B${r}`);
    c.value = { formula };
    c.font = { bold: true };
    // La riga 1 e' una DATA: senza formato Excel mostra il numero seriale.
    if (i === 1) c.numFmt = "yyyy-mm-dd";
    else if (i >= 2) c.numFmt = "#,##0";
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ROSSO } };
  });

  ws.getColumn(1).width = 34;
  ws.getColumn(2).width = 14;
  for (let c = 3; c <= 10; c++) ws.getColumn(c).width = 13;
  ws.getColumn(9).width = 15;
  ws.views = [{ state: "frozen", ySplit: R0 }];

  return Buffer.from(await wb.xlsx.writeBuffer());
}
