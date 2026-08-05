/**
 * Generatore della cartella Excel.
 *
 * ANTEPRIMA: i numeri settimanali sono ancora costanti — dietro non c'e' il
 * motore, e i sei input non sono ancora parametri. Quello che qui e' gia'
 * definitivo e' la FORMA: celle di input in testa, formule vere sotto che le
 * referenziano, nessun valore in cache, ricalcolo forzato all'apertura.
 *
 * Aperta in Excel il 2026-08-05: nessuna richiesta di riparazione, e i valori
 * comparivano pur non essendo scritti nel file — li aveva calcolati Excel.
 * Il differenziale del prodotto e' verificato.
 */
import ExcelJS from "exceljs";

const GIORNI = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
] as const;

/** 5 = venerdì. Convenzione della pratica americana; cade dove cadono
 *  stipendi e chiusure bancarie. Parametrica, e scritta nell'intestazione. */
export const FINE_SETTIMANA_PREDEFINITA = 5;

function primaChiusura(inizio: Date, giorno: number): Date {
  const d = new Date(Date.UTC(inizio.getUTCFullYear(), inizio.getUTCMonth(), inizio.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + ((giorno - d.getUTCDay() + 7) % 7));
  return d;
}

export function settimane(inizio: Date, giorno = FINE_SETTIMANA_PREDEFINITA, quante = 13): Date[] {
  const prima = primaChiusura(inizio, giorno);
  return Array.from({ length: quante }, (_, i) => {
    const f = new Date(prima);
    f.setUTCDate(prima.getUTCDate() + i * 7);
    return f;
  });
}

const iso = (d: Date): string => d.toISOString().slice(0, 10);

export async function generaCartella(
  inizio = new Date(Date.UTC(2026, 7, 5)),
  giorno = FINE_SETTIMANA_PREDEFINITA,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ledgerworks — cashflow13";
  // Nessun valore in cache + ricalcolo all'apertura: senza questo la cartella
  // mostra numeri vecchi finche' l'utente non tocca una cella.
  wb.calcProperties.fullCalcOnLoad = true;

  const ws = wb.addWorksheet("13-Week Cash Flow");
  const fine = settimane(inizio, giorno);
  const w1 = fine[0], w13 = fine[12];
  if (!w1 || !w13) throw new Error("calendario incompleto");

  ws.getCell("A1").value = "13-Week Cash Flow Plan";
  ws.getCell("A1").font = { bold: true, size: 16 };
  ws.getCell("A2").value =
    `Weeks end on ${GIORNI[giorno] ?? "?"} · Week 1 ends ${iso(w1)} · Week 13 ends ${iso(w13)} · EUR`;
  ws.getCell("A2").font = { italic: true, color: { argb: "FF666666" } };

  ws.getCell("A4").value = "INPUTS — change any yellow cell, everything below recalculates";
  ws.getCell("A4").font = { bold: true };

  const input: Array<[string, number]> = [
    ["Opening cash balance", 45000],
    ["Expected receipts (per week)", 28000],
    ["Supplier payments (per week)", 19000],
    ["Payroll (per week)", 14500],
    ["Loan instalments (per week)", 3200],
    ["VAT / taxes due (per week)", 4100],
  ];
  input.forEach(([etichetta, valore], i) => {
    ws.getCell(`A${5 + i}`).value = etichetta;
    const c = ws.getCell(`B${5 + i}`);
    c.value = valore;
    c.numFmt = "#,##0";
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF3C4" } };
    c.border = {
      top: { style: "thin" }, left: { style: "thin" },
      bottom: { style: "thin" }, right: { style: "thin" },
    };
  });

  const R0 = 13;
  ["Week", "Week ending", "Opening", "Receipts", "Suppliers", "Payroll",
   "Loans", "VAT / Tax", "Net movement", "Closing"].forEach((h, i) => {
    const c = ws.getRow(R0).getCell(i + 1);
    c.value = h;
    c.font = { bold: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
    c.border = { bottom: { style: "medium" } };
  });

  for (let s = 0; s < 13; s++) {
    const r = R0 + 1 + s;
    const row = ws.getRow(r);
    row.getCell(1).value = s + 1;
    row.getCell(2).value = fine[s] ?? null;
    row.getCell(2).numFmt = "yyyy-mm-dd";
    row.getCell(3).value = { formula: s === 0 ? "$B$5" : `J${r - 1}` };
    row.getCell(4).value = { formula: "$B$6" };
    row.getCell(5).value = { formula: "$B$7" };
    row.getCell(6).value = { formula: "$B$8" };
    row.getCell(7).value = { formula: "$B$9" };
    row.getCell(8).value = { formula: "$B$10" };
    row.getCell(9).value = { formula: `D${r}-E${r}-F${r}-G${r}-H${r}` };
    row.getCell(10).value = { formula: `C${r}+I${r}` };
    for (let c = 3; c <= 10; c++) row.getCell(c).numFmt = "#,##0";
    row.getCell(10).font = { bold: true };
  }

  const P = R0 + 1, U = R0 + 13, K = U + 2;
  ws.getCell(`A${K}`).value = "THE ANSWER";
  ws.getCell(`A${K}`).font = { bold: true, size: 13 };

  const risposte: Array<[string, string]> = [
    ["First week cash goes negative",
     `IFERROR(MATCH(TRUE,INDEX($J$${P}:$J$${U}<0,0),0),"never — stays positive")`],
    ["Date of that week",
     `IFERROR(INDEX($B$${P}:$B$${U},MATCH(TRUE,INDEX($J$${P}:$J$${U}<0,0),0)),"—")`],
    ["Shortfall in that week",
     `IFERROR(INDEX($J$${P}:$J$${U},MATCH(TRUE,INDEX($J$${P}:$J$${U}<0,0),0)),0)`],
    // Il fabbisogno massimo e' il picco cumulato, NON lo scoperto della prima
    // settimana negativa: sono due numeri diversi e vengono confusi spesso.
    ["Peak funding need over 13 weeks", `IF(MIN($J$${P}:$J$${U})<0,-MIN($J$${P}:$J$${U}),0)`],
    ["Lowest closing balance", `MIN($J$${P}:$J$${U})`],
  ];
  risposte.forEach(([etichetta, formula], i) => {
    ws.getCell(`A${K + 1 + i}`).value = etichetta;
    const c = ws.getCell(`B${K + 1 + i}`);
    c.value = { formula };
    c.font = { bold: true };
    // La riga 1 restituisce una DATA: senza formato Excel mostra il numero
    // seriale (46262 invece di 2026-08-28). Le righe 2-4 sono importi.
    if (i === 1) c.numFmt = "yyyy-mm-dd";
    else if (i >= 2) c.numFmt = "#,##0";
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCE8E6" } };
  });

  ws.getColumn(1).width = 34;
  ws.getColumn(2).width = 14;
  for (let c = 3; c <= 10; c++) ws.getColumn(c).width = 13;
  ws.getColumn(9).width = 15; // "Net movement" non ci stava in 13

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
