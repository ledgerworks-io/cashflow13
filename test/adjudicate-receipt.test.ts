import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { adjudicate, type EmailAdjudication } from "../src/adjudicate/verdict.js";
import { describeReason, generateVerdictReceipt } from "../src/adjudicate/receipt.js";
import { DEFAULT_POLICY } from "../src/adjudicate/billing.js";
import type { FilterRule } from "../src/audit/report.js";
import { entryFromZip } from "./helpers/xlsx.js";

/**
 * La ricevuta dell'aggiudicatore.
 *
 * Vale la stessa regola della cartella del piano di cassa (DIARIO §6): formule
 * vere, nessun valore in cache, ricalcolo all'apertura. Ma qui c'è una cosa in
 * più, ed è il prodotto: **i totali in testa sono formule che contano i verdetti
 * riga per riga.** Il cliente non deve credere ai nostri numeri — li vede
 * derivare dai singoli verdetti, e può rifare il conto.
 *
 * Se un giorno qualcuno "ottimizza" scrivendo i totali come numeri fissi, la
 * ricevuta smette di essere una prova e torna a essere un'affermazione. I test
 * qui sotto esistono per impedirlo.
 */

const righe = [
  { id: "a", email: "mario@example.com", regione: "Lombardia" },
  { id: "b", email: "", regione: "Lombardia" },
  { id: "c", email: "tizio@azienda.com", regione: "Lazio" },
  { id: "a", email: "mario@example.com", regione: "Lombardia" }, // doppione
];
const soloLombardia: FilterRule[] = [{ field: "regione", op: "equals", value: "Lombardia" }];
const emailPiena: FilterRule[] = [{ field: "email", op: "nonEmpty" }];

const indecidibile: EmailAdjudication = {
  verdict: "undecidable",
  reason: "casella non verificabile senza SMTP",
};

function giudizio() {
  return adjudicate(righe, {
    dedupeKeys: ["id"],
    filters: [...soloLombardia, ...emailPiena],
    amountPaidUsd: 10,
  });
}

async function apri(buf: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}

/** Le celle della ricevuta che devono essere formule, non numeri. */
const CELLE_FORMULA = ["B6", "B7", "B8", "B9", "B10", "B12", "B13", "B15", "B16", "B17"];

describe("la ricevuta è viva, non una fotografia", () => {
  it("chiede il ricalcolo all'apertura — verificato nell'XML, non nel round-trip", async () => {
    const buf = await generateVerdictReceipt(giudizio(), { amountPaidUsd: 10 });
    expect(entryFromZip(buf, "xl/workbook.xml")).toMatch(/fullCalcOnLoad="1"/);
  });

  it("nessun valore in cache accanto alle formule, nel file consegnato", async () => {
    const buf = await generateVerdictReceipt(giudizio(), { amountPaidUsd: 10 });
    const foglio = entryFromZip(buf, "xl/worksheets/sheet1.xml");
    for (const rif of CELLE_FORMULA) {
      const cella = new RegExp(`<c r="${rif}"[^>]*>(.*?)</c>`).exec(foglio)?.[1] ?? "";
      expect(cella, `${rif} deve contenere una formula`).toMatch(/<f>/);
      expect(cella, `${rif} non deve avere un valore in cache`).not.toMatch(/<v>/);
      expect(cella, `${rif} non deve iniziare con =`).not.toMatch(/<f>=/);
    }
  });

  it("l'importo pagato è una cella di input modificabile", async () => {
    const wb = await apri(await generateVerdictReceipt(giudizio(), { amountPaidUsd: 7.5 }));
    const ws = wb.worksheets[0]!;
    expect(ws.getCell("B5").value).toBe(7.5);
    expect((ws.getCell("B5").fill as ExcelJS.FillPattern)?.fgColor?.argb).toBe("FFFFF3C4");
  });
});

describe("i totali si contano dai verdetti, non si affermano", () => {
  it("ogni conteggio è una formula che guarda il foglio dei verdetti", async () => {
    const wb = await apri(await generateVerdictReceipt(giudizio(), { amountPaidUsd: 10 }));
    const ws = wb.worksheets[0]!;
    for (const rif of ["B6", "B7", "B8", "B9", "B10", "B12", "B13"]) {
      const f = (ws.getCell(rif).value as { formula?: string })?.formula ?? "";
      expect(f, `${rif} deve contare dal foglio dei verdetti`).toMatch(/Verdicts/);
    }
  });

  it("il costo per record utile discende dalla cella dell'importo, non da un numero scritto", async () => {
    const wb = await apri(await generateVerdictReceipt(giudizio(), { amountPaidUsd: 10 }));
    const f = (wb.worksheets[0]!.getCell("B16").value as { formula?: string })?.formula ?? "";
    expect(f).toContain("B5");
    expect(f).toContain("B7");
  });

  it("le formule non contengono il segno di uguale iniziale", async () => {
    const wb = await apri(await generateVerdictReceipt(giudizio(), { amountPaidUsd: 10 }));
    const ws = wb.worksheets[0]!;
    for (const rif of CELLE_FORMULA) {
      const f = (ws.getCell(rif).value as { formula?: string })?.formula ?? "";
      expect(f.startsWith("="), `${rif}`).toBe(false);
    }
  });
});

describe("il foglio dei verdetti: una riga per ogni riga consegnata", () => {
  it("non ne perde e non ne inventa", async () => {
    const wb = await apri(await generateVerdictReceipt(giudizio(), {}));
    const ws = wb.getWorksheet("Verdicts")!;
    expect(ws.rowCount).toBe(righe.length + 1); // + intestazione
  });

  it("la posizione è quella del file del cliente: si conta da 1, non da 0", async () => {
    // Un rapporto che dice «riga 0» costringe il cliente a fare aritmetica
    // sulla nostra convenzione interna. Non è compito suo.
    const wb = await apri(await generateVerdictReceipt(giudizio(), {}));
    const ws = wb.getWorksheet("Verdicts")!;
    expect(ws.getCell("A2").value).toBe(1);
    expect(ws.getCell("A5").value).toBe(4);
  });

  it("dice il verdetto con una parola tradotta, non con un codice", async () => {
    const wb = await apri(await generateVerdictReceipt(giudizio(), {}));
    const ws = wb.getWorksheet("Verdicts")!;
    expect(ws.getCell("B2").value).toBe("Usable");
    expect(ws.getCell("B5").value).toBe("Duplicate");
  });

  it("dice per ogni riga se è stata addebitata", async () => {
    // Non «Sì/No»: in italiano «No» è identico all'inglese, e il test di casa
    // che vieta le traduzioni copiate avrebbe ragione a lamentarsi. Un'etichetta
    // che si spiega da sola è comunque meglio in una ricevuta.
    const wb = await apri(await generateVerdictReceipt(giudizio(), {}));
    const ws = wb.getWorksheet("Verdicts")!;
    expect(ws.getCell("C2").value).toBe("Charged");
  });

  it("scrive la ragione in parole, con il nome del campo che l'ha causata", async () => {
    const wb = await apri(await generateVerdictReceipt(giudizio(), {}));
    const ws = wb.getWorksheet("Verdicts")!;
    expect(String(ws.getCell("D3").value)).toContain("email"); // riga 2: email vuota
  });

  it("la riga non addebitata lo dichiara, così il cliente vede la garanzia applicata", async () => {
    const g = adjudicate([{ email: "tizio@azienda.com", regione: "Lombardia" }], {
      filters: soloLombardia,
      emailField: "email",
      emailLookup: () => indecidibile,
    });
    const wb = await apri(await generateVerdictReceipt(g, {}));
    const ws = wb.getWorksheet("Verdicts")!;
    expect(ws.getCell("B2").value).toBe("Not adjudicated");
    expect(ws.getCell("C2").value).toBe("Not charged");
  });
});

describe("le etichette passano dalla tabella di localizzazione", () => {
  it("in italiano i fogli e i verdetti sono in italiano", async () => {
    const wb = await apri(await generateVerdictReceipt(giudizio(), { locale: "it" }));
    const ws = wb.getWorksheet("Verdetti")!;
    expect(ws).toBeDefined();
    expect(ws.getCell("B2").value).toBe("Utilizzabile");
  });

  it("il nome del foglio con lo spazio non rompe la formula che lo cita", async () => {
    // Un riferimento a un foglio con spazi va fra apici singoli, altrimenti
    // Excel apre il file con il messaggio «da riparare».
    const wb = await apri(await generateVerdictReceipt(giudizio(), { locale: "it" }));
    const f = (wb.worksheets[0]!.getCell("B7").value as { formula?: string })?.formula ?? "";
    expect(f).toMatch(/Verdetti/);
    expect(f).not.toMatch(/[^']Verdetti [^']/);
  });

  it("la garanzia è scritta nella ricevuta, non solo nella scheda del prodotto", async () => {
    const wb = await apri(await generateVerdictReceipt(giudizio(), { locale: "it" }));
    const testo = wb.worksheets[0]!.getCell("A19").value;
    expect(String(testo)).toMatch(/non te lo addebitiamo/i);
  });
});

describe("quanto costa, dentro la ricevuta e non solo sulla scheda", () => {
  it("senza politica il blocco non c'è: la ricevuta resta quella di prima", async () => {
    const wb = await apri(await generateVerdictReceipt(giudizio(), { amountPaidUsd: 10 }));
    expect(wb.worksheets[0]!.getCell("A23").value).toBeNull();
  });

  it("il totale è una formula, non un numero affermato", async () => {
    const wb = await apri(
      await generateVerdictReceipt(giudizio(), { amountPaidUsd: 10, policy: DEFAULT_POLICY }),
    );
    const f = (wb.worksheets[0]!.getCell("B28").value as { formula?: string })?.formula ?? "";
    expect(f).toBe("MIN(B25*B26,B27)");
  });

  it("il tetto discende dai record CONSEGNATI, che la ricevuta conta da sola", async () => {
    // B6 è «Records delivered», ed è a sua volta una COUNTA sui verdetti. Il
    // cliente risale dalla fattura fino alle righe senza credere a niente.
    const wb = await apri(
      await generateVerdictReceipt(giudizio(), { amountPaidUsd: 10, policy: DEFAULT_POLICY }),
    );
    const f = (wb.worksheets[0]!.getCell("B27").value as { formula?: string })?.formula ?? "";
    expect(f).toBe("B6/1000*1.5");
  });

  it("l'ETICHETTA del tetto dice la stessa tariffa che la formula applica", async () => {
    // Fino al 7 agosto 2026 l'etichetta era «Cap: $0.75 per 1,000 records you
    // gave us» **scritta a mano** nella tabella di localizzazione, mentre la
    // formula accanto discendeva da `DEFAULT_POLICY`. Alzando il tetto la
    // ricevuta avrebbe DICHIARATO $0,75 e CALCOLATO $1,50 nella cella sotto:
    // due numeri diversi nello stesso documento, che è precisamente l'accusa
    // di bait-and-switch. Nessun test la guardava perché era un'etichetta.
    const wb = await apri(
      await generateVerdictReceipt(giudizio(), { amountPaidUsd: 10, policy: DEFAULT_POLICY }),
    );
    const etichetta = String(wb.worksheets[0]!.getCell("A27").value ?? "");
    expect(etichetta).toContain(DEFAULT_POLICY.capUsdPer1000Delivered.toFixed(2));
    expect(etichetta, "nessun numero cablato rimasto").not.toMatch(/\{n\}/);

    // e in italiano, dove la virgola decimale cambia
    const it = await apri(
      await generateVerdictReceipt(giudizio(), { policy: DEFAULT_POLICY, locale: "it" }),
    );
    const etichettaIt = String(it.worksheets[0]!.getCell("A27").value ?? "");
    expect(etichettaIt).toContain(
      DEFAULT_POLICY.capUsdPer1000Delivered.toFixed(2).replace(".", ","),
    );
  });

  it("il tetto NON dipende più dall'importo che il cliente dichiara", async () => {
    // Era la falla: la cella del tetto guardava B5 (l'importo pagato), quindi
    // dichiarare zero azzerava la fattura su record dimostrati.
    const wb = await apri(
      await generateVerdictReceipt(giudizio(), { amountPaidUsd: 10, policy: DEFAULT_POLICY }),
    );
    const f = (wb.worksheets[0]!.getCell("B27").value as { formula?: string })?.formula ?? "";
    expect(f).not.toMatch(/B5/);
  });

  it("i record addebitati discendono dagli aggiudicati meno la quota gratuita", async () => {
    const wb = await apri(
      await generateVerdictReceipt(giudizio(), { amountPaidUsd: 10, policy: DEFAULT_POLICY }),
    );
    const ws = wb.worksheets[0]!;
    expect((ws.getCell("B25").value as { formula?: string })?.formula).toBe("MAX(0,B12-B24)");
    expect(ws.getCell("B24").value).toBe(DEFAULT_POLICY.freePerRun);
    expect(ws.getCell("B26").value).toBe(DEFAULT_POLICY.pricePerRecordUsd);
  });

  it("il tetto c'è ANCHE senza importo dichiarato: non dipende più da lui", async () => {
    // Prima, senza `amountPaidUsd` il blocco del tetto spariva dalla ricevuta
    // e il cliente non aveva modo di vedere la terza promessa applicata.
    const wb = await apri(await generateVerdictReceipt(giudizio(), { policy: DEFAULT_POLICY }));
    const ws = wb.worksheets[0]!;
    expect((ws.getCell("B27").value as { formula?: string })?.formula).toBe("B6/1000*1.5");
    expect((ws.getCell("B28").value as { formula?: string })?.formula).toBe("MIN(B25*B26,B27)");
  });

  it("nessun valore in cache nelle celle nuove", async () => {
    const buf = await generateVerdictReceipt(giudizio(), {
      amountPaidUsd: 10, policy: DEFAULT_POLICY,
    });
    const foglio = entryFromZip(buf, "xl/worksheets/sheet1.xml");
    for (const rif of ["B25", "B27", "B28"]) {
      const cella = new RegExp(`<c r="${rif}"[^>]*>(.*?)</c>`).exec(foglio)?.[1] ?? "";
      expect(cella, rif).toMatch(/<f>/);
      expect(cella, rif).not.toMatch(/<v>/);
      expect(cella, rif).not.toMatch(/<f>=/);
    }
  });
});

describe("le ragioni, scritte per chi legge", () => {
  it("traduce ogni codice in una frase con il campo", () => {
    expect(describeReason({ code: "empty", field: "email" }, "en")).toContain("email");
    expect(describeReason({ code: "duplicate", firstSeenAt: 0 }, "en")).toContain("1");
    expect(
      describeReason(
        { code: "filter", field: "regione", rule: { field: "regione", op: "equals", value: "Lombardia" } },
        "en",
      ),
    ).toContain("Lombardia");
  });

  it("il doppione indica la riga del cliente, contata da 1", () => {
    expect(describeReason({ code: "duplicate", firstSeenAt: 3 }, "en")).toContain("4");
  });
});

describe("quello che non deve far esplodere niente", () => {
  it("un dataset vuoto produce una ricevuta leggibile, non un file rotto", async () => {
    const g = adjudicate([], { dedupeKeys: ["id"], amountPaidUsd: 5 });
    const buf = await generateVerdictReceipt(g, { amountPaidUsd: 5 });
    const wb = await apri(buf);
    expect(entryFromZip(buf, "xl/workbook.xml")).toMatch(/fullCalcOnLoad="1"/);
    expect(String(wb.getWorksheet("Verdicts")!.getCell("A1").value)).toMatch(/Nothing/i);
  });

  it("una riga senza ragioni non lascia una cella con scritto 'undefined'", async () => {
    const wb = await apri(await generateVerdictReceipt(giudizio(), {}));
    const ws = wb.getWorksheet("Verdicts")!;
    expect(ws.getCell("D2").value ?? "").not.toMatch(/undefined/);
  });
});
