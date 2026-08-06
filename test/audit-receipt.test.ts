import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { auditDataset, type FilterRule } from "../src/audit/report.js";
import { entryFromZip } from "./helpers/xlsx.js";
import { describeRule, generateReceipt } from "../src/audit/receipt.js";

const righe = [
  { id: "a", email: "x@y.z" },
  { id: "a", email: "x@y.z" },
  { id: "b", email: "" },
];
const filtri: FilterRule[] = [{ field: "email", op: "nonEmpty" }];

async function apri(buf: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}

describe("la ricevuta è viva, non una fotografia", () => {
  it("chiede il ricalcolo all'apertura — verificato nell'XML, non nel round-trip", async () => {
    const r = auditDataset(righe, { dedupeKeys: ["id"], filters: filtri, amountPaidUsd: 10 });
    const buf = await generateReceipt(r, { amountPaidUsd: 10 });
    const xml = entryFromZip(buf, "xl/workbook.xml");
    expect(xml).toMatch(/fullCalcOnLoad="1"/);
  });

  it("nessun valore in cache accanto alle formule, nel file consegnato", async () => {
    const r = auditDataset(righe, { dedupeKeys: ["id"], filters: filtri, amountPaidUsd: 10 });
    const buf = await generateReceipt(r, { amountPaidUsd: 10 });
    const foglio = entryFromZip(buf, "xl/worksheets/sheet1.xml");
    for (const rif of ["B8", "B11", "B12", "B13"]) {
      const cella = new RegExp(`<c r="${rif}"[^>]*>(.*?)</c>`).exec(foglio)?.[1] ?? "";
      expect(cella, `${rif} deve contenere una formula`).toMatch(/<f>/);
      expect(cella, `${rif} non deve avere un valore in cache`).not.toMatch(/<v>/);
      expect(cella, `${rif} non deve iniziare con =`).not.toMatch(/<f>=/);
    }
  });

  it("non scrive valori in cache accanto alle formule", async () => {
    const r = auditDataset(righe, { dedupeKeys: ["id"], filters: filtri, amountPaidUsd: 10 });
    const wb = await apri(await generateReceipt(r, { amountPaidUsd: 10 }));
    const ws = wb.worksheets[0]!;
    for (const rif of ["B8", "B11", "B12", "B13"]) {
      const v = ws.getCell(rif).value as { formula?: string; result?: unknown };
      expect(v?.formula, `${rif} deve essere una formula`).toBeTruthy();
      expect(v?.result, `${rif} non deve avere un valore in cache`).toBeUndefined();
    }
  });

  it("le formule non contengono il segno di uguale iniziale", async () => {
    const r = auditDataset(righe, { dedupeKeys: ["id"], amountPaidUsd: 10 });
    const wb = await apri(await generateReceipt(r, { amountPaidUsd: 10 }));
    const ws = wb.worksheets[0]!;
    for (const rif of ["B8", "B11", "B12", "B13"]) {
      const v = ws.getCell(rif).value as { formula?: string };
      expect(v.formula?.startsWith("=")).toBe(false);
    }
  });

  it("l'importo pagato è una cella di input modificabile", async () => {
    const r = auditDataset(righe, { dedupeKeys: ["id"], amountPaidUsd: 7.5 });
    const wb = await apri(await generateReceipt(r, { amountPaidUsd: 7.5 }));
    const ws = wb.worksheets[0]!;
    expect(ws.getCell("B5").value).toBe(7.5);
    expect((ws.getCell("B5").fill as ExcelJS.FillPattern)?.fgColor?.argb).toBe("FFFFF3C4");
  });
});

describe("i numeri portati dentro", () => {
  it("consegnati e distinti finiscono nelle celle giuste", async () => {
    const r = auditDataset(righe, { dedupeKeys: ["id"], filters: filtri, amountPaidUsd: 10 });
    const wb = await apri(await generateReceipt(r, { amountPaidUsd: 10 }));
    const ws = wb.worksheets[0]!;
    expect(ws.getCell("B6").value).toBe(3); // consegnati
    expect(ws.getCell("B7").value).toBe(2); // distinti
    expect(ws.getCell("B9").value).toBe(1); // conformi: solo "a"
  });

  it("un foglio per i duplicati, con la chiave leggibile", async () => {
    const r = auditDataset(righe, { dedupeKeys: ["id"] });
    const wb = await apri(await generateReceipt(r, {}));
    const ws = wb.getWorksheet("Duplicates")!;
    expect(ws.getCell("A2").value).toBe("a");
    expect(ws.getCell("B2").value).toBe(2);
  });

  it("quando non c'è niente da segnalare lo dice, non lascia il foglio vuoto", async () => {
    const r = auditDataset([{ id: "solo" }], { dedupeKeys: ["id"] });
    const wb = await apri(await generateReceipt(r, {}));
    expect(String(wb.getWorksheet("Duplicates")!.getCell("A1").value)).toMatch(/Nothing/i);
  });
});

describe("le etichette passano dalla tabella di localizzazione", () => {
  it("in italiano i fogli hanno i nomi italiani", async () => {
    const r = auditDataset(righe, { dedupeKeys: ["id"] });
    const wb = await apri(await generateReceipt(r, { locale: "it" }));
    expect(wb.getWorksheet("Ricevuta")).toBeDefined();
    expect(wb.getWorksheet("Duplicati")).toBeDefined();
  });
});

describe("i criteri, scritti per chi legge", () => {
  it("traduce ogni operatore in una frase", () => {
    expect(describeRule({ field: "stars", op: "min", value: 5 })).toBe("stars >= 5");
    expect(describeRule({ field: "email", op: "nonEmpty" })).toBe("email is present");
    expect(describeRule({ field: "d", op: "after", value: "2026-01-01" }))
      .toBe("d on or after 2026-01-01");
  });
});
