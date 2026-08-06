import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { buildPlan, type CashFlowInputs } from "../src/engine/plan.js";
import { generateWorkbook } from "../src/excel/workbook.js";
import { entryFromZip } from "./helpers/xlsx.js";

/**
 * La cartella Excel del piano di cassa — il differenziale del prodotto.
 *
 * Esiste perché fino al 6 agosto 2026 questo modulo NON aveva un test suo: la
 * copertura stava al 6%, e le due regole che la sua stessa intestazione chiama
 * «non negoziabili» erano garantite da una verifica fatta a mano in Excel il
 * 5 agosto. Cioè: la promessa centrale dello strumento **già pubblico** era
 * sorvegliata da un ricordo.
 *
 * Le regole, dal file stesso:
 *  1. nessun valore in cache accanto alle formule, e ricalcolo forzato
 *     all'apertura — altrimenti il file *sembra* vivo e non lo è;
 *  2. le celle gialle sono INPUT, tutto il resto è formula — è il motivo per
 *     cui il cliente vuole un file invece di una risposta in chat.
 *
 * La regola vale come per la ricevuta dell'aggiudicatore (DIARIO §6): ExcelJS
 * non è un testimone attendibile su sé stesso, quindi si guarda l'XML
 * dell'archivio, non il round-trip della libreria.
 */

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);
const costante = (v: number) => Array.from({ length: 13 }, () => v);

const base = (over: Partial<CashFlowInputs> = {}): CashFlowInputs => ({
  startDate: utc("2026-08-05"),
  openingBalance: 45_000,
  receipts: costante(28_000),
  supplierPayments: costante(19_000),
  payroll: costante(14_500),
  loanRepayments: costante(3_200),
  taxes: costante(4_100),
  ...over,
});

/** Un piano che va sotto zero: è il caso per cui uno apre lo strumento. */
const sottoZero = () => base({ openingBalance: 1_000, receipts: costante(5_000) });

async function cartella(inputs: CashFlowInputs = base()): Promise<Buffer> {
  return generateWorkbook(buildPlan(inputs));
}

/** Tutte le celle del foglio, con il loro contenuto grezzo. */
function celle(foglio: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of foglio.matchAll(/<c\b[^>]*r="([A-Z]+\d+)"[^>]*>(.*?)<\/c>/gs)) {
    out.set(m[1]!, m[2]!);
  }
  return out;
}

describe("la cartella è viva, non una fotografia", () => {
  it("chiede il ricalcolo all'apertura — verificato nell'XML, non nel round-trip", async () => {
    const xml = entryFromZip(await cartella(), "xl/workbook.xml");
    expect(xml).toMatch(/fullCalcOnLoad="1"/);
  });

  it("nessuna formula porta con sé un valore in cache", async () => {
    const foglio = entryFromZip(await cartella(), "xl/worksheets/sheet1.xml");
    const conFormula = [...celle(foglio)].filter(([, c]) => /<f[ >]/.test(c));
    expect(conFormula.length).toBeGreaterThan(20);
    for (const [rif, c] of conFormula) {
      expect(c, `${rif} non deve avere un valore in cache`).not.toMatch(/<v>/);
    }
  });

  it("nessuna formula comincia con il segno di uguale", async () => {
    // ExcelJS vuole la formula SENZA `=`. Con l'uguale Excel apre il file
    // dicendo che è da riparare, e il cliente vede un avviso rosso.
    const foglio = entryFromZip(await cartella(), "xl/worksheets/sheet1.xml");
    for (const [rif, c] of celle(foglio)) {
      if (/<f[ >]/.test(c)) expect(c, `${rif}`).not.toMatch(/<f[^>]*>=/);
    }
  });

  it("il foglio contiene comunque delle costanti: gli input", async () => {
    // Controprova: se non ci fosse NESSUN valore, la prova qui sopra passerebbe
    // anche con un file vuoto.
    const foglio = entryFromZip(await cartella(), "xl/worksheets/sheet1.xml");
    expect(foglio).toMatch(/<v>/);
  });
});

describe("le risposte discendono dalla griglia, non sono numeri scritti", () => {
  it("il saldo iniziale è una cella di input, e la settimana 1 la guarda", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await cartella());
    const ws = wb.worksheets[0]!;

    // B5 è l'input: un numero vero, che il cliente cambia.
    expect(ws.getCell("B5").value).toBe(45_000);
    // La prima settimana apre da lì, con un riferimento assoluto.
    expect(ws.getCell("C8").value).toMatchObject({ formula: "$B$5" });
  });

  it("ogni settimana apre dove ha chiuso la precedente: la catena è di formule", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await cartella());
    const ws = wb.worksheets[0]!;

    for (let r = 9; r <= 20; r++) {
      expect(ws.getCell(`C${r}`).value, `C${r}`).toMatchObject({ formula: `J${r - 1}` });
    }
  });

  it("il saldo di chiusura è apertura più flusso netto, per ogni settimana", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await cartella());
    const ws = wb.worksheets[0]!;

    for (let r = 8; r <= 20; r++) {
      expect(ws.getCell(`I${r}`).value, `I${r}`)
        .toMatchObject({ formula: `D${r}-E${r}-F${r}-G${r}-H${r}` });
      expect(ws.getCell(`J${r}`).value, `J${r}`)
        .toMatchObject({ formula: `C${r}+I${r}` });
    }
  });

  it("«la settimana in cui la cassa va sotto zero» è una formula sulla colonna J", async () => {
    // È la risposta per cui il cliente apre lo strumento. Se fosse un numero
    // scritto, cambiare un input non la muoverebbe e il file mentirebbe.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await cartella(sottoZero()));
    const ws = wb.worksheets[0]!;

    const risposta = ws.getCell("B23").value as { formula?: string };
    expect(risposta.formula, "la prima settimana negativa deve essere una formula")
      .toMatch(/MATCH\(TRUE,INDEX\(\$J\$8:\$J\$20<0,0\),0\)/);
  });

  it("il fabbisogno di picco guarda il MINIMO della colonna, non la prima settimana negativa", async () => {
    // La cassa può risalire e poi sprofondare più giù: usare lo scoperto della
    // prima settimana negativa sottostimerebbe quanto serve davvero.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await cartella(sottoZero()));
    const ws = wb.worksheets[0]!;

    const picco = ws.getCell("B26").value as { formula?: string };
    expect(picco.formula).toMatch(/MIN\(\$J\$8:\$J\$20\)/);
    expect(picco.formula).toMatch(/^IF\(MIN/);
  });

  it("nessuna cella delle risposte contiene il numero che il motore ha calcolato", async () => {
    // La prova che le risposte non sono state «ottimizzate» in numeri fissi:
    // il valore del motore non deve comparire come costante in quelle celle.
    const piano = buildPlan(sottoZero());
    expect(piano.firstNegativeWeek).not.toBeNull();

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await generateWorkbook(piano));
    const ws = wb.worksheets[0]!;

    for (const rif of ["B23", "B24", "B25", "B26", "B27"]) {
      const v = ws.getCell(rif).value;
      expect(typeof v, `${rif} deve essere una formula, non un valore`).not.toBe("number");
      expect(v).toHaveProperty("formula");
    }
  });
});

describe("l'intestazione si corregge da sola", () => {
  it("la riga della convenzione è una formula sulle date, non testo fisso", async () => {
    // Un file che dice «chiude di venerdì» mentre le date sono di lunedì è
    // peggio di un file senza intestazione.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await cartella());
    const ws = wb.worksheets[0]!;

    const a2 = ws.getCell("A2").value as { formula?: string };
    expect(a2.formula).toMatch(/TEXT\(\$B\$8,"dddd"\)/);
  });

  it("le date delle settimane successive sono formule: +7 sulla precedente", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await cartella());
    const ws = wb.worksheets[0]!;

    for (let r = 9; r <= 20; r++) {
      expect(ws.getCell(`B${r}`).value, `B${r}`).toMatchObject({ formula: `B${r - 1}+7` });
    }
  });
});
