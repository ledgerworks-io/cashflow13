/**
 * La ricevuta in Excel.
 *
 * Stesso principio della cartella del piano di cassa: nessun valore in cache
 * accanto alle formule, ricalcolo forzato all'apertura, celle gialle di input.
 * Chi la riceve può correggere l'importo pagato e vedere muoversi il costo per
 * record utile — che è il numero per cui ha aperto lo strumento.
 *
 * I conteggi (consegnati, distinti, conformi) sono dati: vengono dal dataset e
 * non si ricalcolano da soli. Tutto il resto è formula.
 */
import ExcelJS from "exceljs";

import { t, type Locale } from "../i18n/index.js";
import type { AuditReport, FilterRule } from "./report.js";

export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const GIALLO = "FFFFF3C4";
const GRIGIO = "FFF2F2F2";
const ROSSO = "FFFCE8E6";

/** Un criterio, scritto in modo che lo capisca chi non ha scritto lo schema. */
export function describeRule(rule: FilterRule): string {
  switch (rule.op) {
    case "nonEmpty":
      return `${rule.field} is present`;
    case "equals":
      return `${rule.field} = ${JSON.stringify(rule.value)}`;
    case "oneOf":
      return `${rule.field} is one of ${JSON.stringify(rule.value)}`;
    case "min":
      return `${rule.field} >= ${rule.value}`;
    case "max":
      return `${rule.field} <= ${rule.value}`;
    case "after":
      return `${rule.field} on or after ${rule.value}`;
    case "before":
      return `${rule.field} on or before ${rule.value}`;
    case "matches":
      return `${rule.field} matches /${rule.value}/`;
  }
}

export interface ReceiptOptions {
  amountPaidUsd?: number | undefined;
  locale?: Locale | undefined;
  /** Solo etichetta, per sapere di che esecuzione si parla. */
  source?: string | undefined;
}

export async function generateReceipt(
  report: AuditReport,
  options: ReceiptOptions = {},
): Promise<Buffer> {
  const loc = options.locale ?? "en";
  const wb = new ExcelJS.Workbook();
  wb.creator = "ledgerworks — run auditor";
  wb.calcProperties.fullCalcOnLoad = true;

  // --- Ricevuta ---------------------------------------------------------
  const ws = wb.addWorksheet(t("audit.sheet.receipt", loc));
  ws.getColumn(1).width = 42;
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

  // Conteggi: dati, non formule. Vengono dal dataset.
  const dati: [string, number][] = [
    [t("audit.delivered", loc), report.total],
    [t("audit.unique", loc), report.unique],
  ];
  dati.forEach(([etichetta, valore], i) => {
    const r = 6 + i;
    ws.getCell(`A${r}`).value = etichetta;
    const c = ws.getCell(`B${r}`);
    c.value = valore;
    c.numFmt = "#,##0";
  });

  // Da qui in giù: solo formule, così l'utente può rifare i conti a mano.
  ws.getCell("A8").value = t("audit.duplicates", loc);
  ws.getCell("B8").value = { formula: "B6-B7" };
  ws.getCell("B8").numFmt = "#,##0";

  ws.getCell("A9").value = t("audit.good", loc);
  ws.getCell("B9").value = report.good;
  ws.getCell("B9").numFmt = "#,##0";

  ws.getCell("A11").value = t("audit.cost_delivered", loc);
  ws.getCell("B11").value = { formula: "IF(B6=0,\"\",B5/B6)" };
  ws.getCell("B11").numFmt = "#,##0.00000";

  ws.getCell("A12").value = t("audit.cost_good", loc);
  const costoUtile = ws.getCell("B12");
  costoUtile.value = { formula: "IF(B9=0,\"\",B5/B9)" };
  costoUtile.numFmt = "#,##0.00000";
  costoUtile.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ROSSO } };
  costoUtile.font = { bold: true };

  ws.getCell("A13").value = t("audit.ratio", loc);
  ws.getCell("B13").value = { formula: "IF(OR(B9=0,B6=0),\"\",(B5/B9)/(B5/B6))" };
  ws.getCell("B13").numFmt = "#,##0.00";

  if (options.amountPaidUsd === undefined) {
    ws.getCell("A15").value = t("audit.no_price", loc);
    ws.getCell("A15").font = { italic: true };
  }
  ws.getCell("A17").value = t("audit.scope", loc);
  ws.getCell("A17").font = { italic: true, size: 10 };

  // --- Fogli di dettaglio ------------------------------------------------
  tabella(wb, t("audit.sheet.duplicates", loc),
    [t("audit.col.key", loc), t("audit.col.count", loc)],
    report.duplicateGroups.map((g) => [g.key, g.count]), loc);

  tabella(wb, t("audit.sheet.violations", loc),
    [t("audit.col.rule", loc), t("audit.col.failing", loc)],
    report.violations.map((v) => [describeRule(v.rule), v.count]), loc);

  tabella(wb, t("audit.sheet.empty", loc),
    [t("audit.col.field", loc), t("audit.col.count", loc)],
    report.emptyFields.map((e) => [e.field, e.count]), loc);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

function tabella(
  wb: ExcelJS.Workbook,
  nome: string,
  intestazioni: string[],
  righe: [string, number][],
  loc: Locale,
): void {
  const ws = wb.addWorksheet(nome);
  ws.getColumn(1).width = 52;
  ws.getColumn(2).width = 14;

  if (righe.length === 0) {
    ws.getCell("A1").value = t("audit.none", loc);
    ws.getCell("A1").font = { italic: true };
    return;
  }

  intestazioni.forEach((h, i) => {
    const c = ws.getCell(1, i + 1);
    c.value = h;
    c.font = { bold: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRIGIO } };
  });
  righe.forEach(([etichetta, n], i) => {
    ws.getCell(i + 2, 1).value = etichetta;
    const c = ws.getCell(i + 2, 2);
    c.value = n;
    c.numFmt = "#,##0";
  });
}
