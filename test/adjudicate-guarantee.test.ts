import { readFileSync } from "node:fs";

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { adjudicate, type EmailAdjudication } from "../src/adjudicate/verdict.js";
import { generateVerdictReceipt } from "../src/adjudicate/receipt.js";
import { DEFAULT_POLICY } from "../src/adjudicate/billing.js";
import type { FilterRule } from "../src/audit/report.js";

/**
 * La garanzia, provata sui soldi e non solo sulla logica.
 *
 * «Paghi solo i record che siamo riusciti ad aggiudicare» non è una frase di
 * marketing: dal momento in cui si incassa diventa una dichiarazione
 * commerciale. Se il codice addebitasse un record non aggiudicato non sarebbe
 * un difetto — sarebbe pubblicità ingannevole.
 *
 * Questi test sono la prova che la promessa regge end-to-end: dal motore, al
 * conteggio addebitabile, fino alla colonna «Addebito» del file che il cliente
 * riceve.
 *
 * La composizione della lista non è inventata: è quella misurata dallo spike
 * del 6 agosto 2026 su una lista B2B stile Apollo/LinkedIn (DIARIO §12). Così
 * il 17,5% di copertura smette di essere una nota nel diario e diventa un test
 * che si rompe se cambia.
 */

const INDECIDIBILE: EmailAdjudication = {
  verdict: "undecidable",
  reason: "dominio valido; casella non verificabile senza SMTP",
};

/** La lista B2B misurata: 200 record, composizione dello spike. */
const MIX = [
  // Indirizzi personali a dominio aziendale: 0 aggiudicati su 60 nello spike.
  { tipo: "corporate", n: 140, email: (i: number) => `persona${i}@azienda${i % 9}.com` },
  // Provider di massa: idem, indecidibili senza SMTP.
  { tipo: "mass", n: 25, email: (i: number) => `persona${i}@gmail.com` },
  // Da qui in giù: tutto aggiudicabile con certezza, senza rete o quasi.
  { tipo: "role", n: 20, email: (i: number) => `info@azienda${i % 9}.com` },
  { tipo: "dead", n: 8, email: (i: number) => `tizio${i}@dominio-morto-${i}.invalid` },
  { tipo: "typo", n: 4, email: (i: number) => `tizio${i}@gmial.com` },
  { tipo: "syntax", n: 2, email: (i: number) => `non-una-email-${i}` },
  { tipo: "disposable", n: 1, email: (i: number) => `tizio${i}@mailinator.com` },
] as const;

const INDECIDIBILI_ATTESI = 140 + 25; // corporate + provider di massa
const TOTALE = MIX.reduce((s, m) => s + m.n, 0);

function listaB2B() {
  const righe: { id: string; email: string; regione: string; tipo: string }[] = [];
  let i = 0;
  for (const m of MIX) {
    for (let k = 0; k < m.n; k++, i++) {
      righe.push({ id: `r${i}`, email: m.email(i), regione: "Lombardia", tipo: m.tipo });
    }
  }
  return righe;
}

/** Il giudizio sulle email, come lo darà il livello DNS misurato dallo spike. */
function giudiceEmail(address: string): EmailAdjudication {
  if (!address.includes("@")) return { verdict: "undeliverable", reason: "sintassi non valida" };
  const dominio = address.split("@")[1]!;
  if (dominio === "mailinator.com") return { verdict: "disposable", reason: "usa e getta" };
  if (dominio.endsWith(".invalid")) return { verdict: "undeliverable", reason: "dominio inesistente" };
  if (dominio === "gmial.com") return { verdict: "suspect", reason: "possibile errore di battitura" };
  if (address.startsWith("info@")) return { verdict: "role", reason: "indirizzo di ruolo" };
  return INDECIDIBILE; // aziendale o provider di massa: non decidibile senza SMTP
}

const criteri: FilterRule[] = [
  { field: "regione", op: "equals", value: "Lombardia" },
  { field: "email", op: "nonEmpty" },
];

function giudizio(prezzoPerRecord = 0.05) {
  const righe = listaB2B();
  return {
    righe,
    prezzo: prezzoPerRecord,
    g: adjudicate(righe, {
      dedupeKeys: ["id"],
      filters: criteri,
      emailField: "email",
      emailLookup: giudiceEmail,
    }),
  };
}

describe("l'invariante che non deve rompersi mai", () => {
  it("nessun record non aggiudicato viene mai addebitato", () => {
    const { g } = giudizio();
    const traditi = g.records.filter((r) => r.verdict === "undecidable" && r.billable);
    expect(traditi).toEqual([]);
  });

  it("e viceversa: tutto ciò che ha un verdetto certo viene addebitato", () => {
    // Serve l'altro verso, altrimenti «non addebitare mai niente» passerebbe.
    const { g } = giudizio();
    const persi = g.records.filter((r) => r.verdict !== "undecidable" && !r.billable);
    expect(persi).toEqual([]);
  });

  it("i due conteggi coprono tutto il consegnato, senza buchi né doppi", () => {
    const { g } = giudizio();
    expect(g.summary.billable + g.summary.notBillable).toBe(TOTALE);
    expect(g.summary.total).toBe(TOTALE);
  });
});

describe("il conto in soldi, sulla lista misurata dallo spike", () => {
  it("su una lista B2B si addebita il 17,5% — il numero dello spike, non un'ipotesi", () => {
    const { g } = giudizio();
    expect(g.summary.notBillable).toBe(INDECIDIBILI_ATTESI);
    expect(g.summary.billable).toBe(TOTALE - INDECIDIBILI_ATTESI);
    expect(g.summary.billable / TOTALE).toBeCloseTo(0.175, 3);
  });

  it("il cliente paga meno di quanto pagherebbe da chiunque altro, e di quanto esatto", () => {
    const { g, prezzo } = giudizio(0.05);
    const comeGliAltri = TOTALE * prezzo; // si fattura tutto il consegnato
    const conLaGaranzia = g.summary.billable * prezzo;
    const risparmio = comeGliAltri - conLaGaranzia;

    expect(comeGliAltri).toBeCloseTo(10.0, 6);
    expect(conLaGaranzia).toBeCloseTo(1.75, 6);
    expect(risparmio).toBeCloseTo(INDECIDIBILI_ATTESI * prezzo, 6);
  });

  it("gli indirizzi di ruolo si addebitano: sono un verdetto certo, non uno scarto", () => {
    // Un «info@» è un lead legittimo per molti compratori: lo si segnala, non
    // lo si scarta al posto suo — ma averlo giudicato è lavoro fatto.
    const { g, righe } = giudizio();
    const ruoli = g.records.filter((r) => righe[r.index]!.tipo === "role");
    expect(ruoli).toHaveLength(20);
    expect(ruoli.every((r) => r.billable)).toBe(true);
    expect(ruoli.every((r) => r.verdict === "good")).toBe(true);
    expect(ruoli.every((r) => r.warnings.length === 1)).toBe(true);
  });

  it("gli indirizzi dimostrati morti si addebitano: dimostrarlo è il servizio", () => {
    const { g, righe } = giudizio();
    const morti = g.records.filter((r) => righe[r.index]!.tipo === "dead");
    expect(morti.every((r) => r.verdict === "rejected" && r.billable)).toBe(true);
  });
});

/**
 * La scheda del prodotto è una dichiarazione commerciale quanto il codice.
 *
 * Esiste perché il 6 agosto 2026 la scheda dichiarava **$0,0017 per record
 * consegnato** mentre il codice, sulla stessa lista, ne faceva $0,000875: un
 * numero pubblicato che non discendeva da nessuna misura e che nessun test
 * sorvegliava. Dichiarare più del vero non è bait-and-switch — è la direzione
 * innocua — ma resta un numero inventato sulla pagina che il cliente legge.
 *
 * Questi test non fissano la cifra: la **ricalcolano dal codice** e pretendono
 * che la scheda dica quella. Cambiare il listino e dimenticare il README
 * adesso rompe la suite.
 */
describe("la scheda del prodotto dice numeri che discendono dal codice", () => {
  const README = readFileSync(
    new URL("../actors/lead-adjudicator/README.md", import.meta.url),
    "utf8",
  );

  it("il prezzo per record aggiudicato è quello di DEFAULT_POLICY", () => {
    expect(README).toContain(
      `$${DEFAULT_POLICY.pricePerRecordUsd} per record we can adjudicate`,
    );
  });

  it("la quota gratuita dichiarata è quella di DEFAULT_POLICY", () => {
    expect(README).toContain(
      `first ${DEFAULT_POLICY.freePerRun} adjudicated records of every run are free`,
    );
  });

  it("il tetto dichiarato è quello di DEFAULT_POLICY", () => {
    expect(DEFAULT_POLICY.capFractionOfDeclaredSpend).toBe(0.5);
    expect(README).toMatch(/never charge more than half of what you tell us/i);
  });

  it("il prezzo per record CONSEGNATO discende dal 17,5% misurato, non da un'ipotesi", () => {
    const { g } = giudizio();
    const quota = g.summary.billable / TOTALE; // 0,175 — misurato, non assunto
    const perConsegnato = DEFAULT_POLICY.pricePerRecordUsd * quota;

    const scritto = README.match(/\$([0-9.]+) per record\s+you gave us/);
    expect(scritto, "la scheda deve dichiarare il prezzo per record consegnato").not.toBeNull();
    expect(Number(scritto![1])).toBeCloseTo(perConsegnato, 9);
  });

  it("«un sesto» è il rapporto vero fra fatturare l'aggiudicato e fatturare tutto", () => {
    const { g } = giudizio();
    // Se fatturassimo ogni record consegnato invece del solo aggiudicato.
    const rapporto = TOTALE / g.summary.billable;
    expect(Math.round(rapporto)).toBe(6);
    expect(README).toMatch(/about a sixth of what the same list would cost/i);
  });

  it("la scheda non promette un tetto che il codice non impone", () => {
    // Il vecchio testo diceva «roughly a sixth of what the data itself cost»:
    // un rapporto col costo del DATO, che il codice non conosce e non può
    // garantire. Il confronto giusto è col nostro stesso listino.
    expect(README).not.toMatch(/sixth of what the data itself cost/i);
    expect(README).not.toContain("$0.0017");
  });
});

describe("la garanzia arriva fino al file che il cliente apre", () => {
  it("la colonna «Addebito» conta esattamente quanto il riepilogo", async () => {
    const { g } = giudizio();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await generateVerdictReceipt(g, { amountPaidUsd: 10 }));
    const ws = wb.getWorksheet("Verdicts")!;

    let addebitati = 0;
    let nonAddebitati = 0;
    for (let r = 2; r <= TOTALE + 1; r++) {
      const v = ws.getCell(r, 3).value;
      if (v === "Charged") addebitati += 1;
      else if (v === "Not charged") nonAddebitati += 1;
    }
    expect(addebitati).toBe(g.summary.billable);
    expect(nonAddebitati).toBe(g.summary.notBillable);
    expect(nonAddebitati).toBe(INDECIDIBILI_ATTESI);
  });

  it("ogni riga non addebitata dice al cliente perché è gratuita", async () => {
    const { g } = giudizio();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await generateVerdictReceipt(g, { amountPaidUsd: 10 }));
    const ws = wb.getWorksheet("Verdicts")!;

    const mute: number[] = [];
    for (let r = 2; r <= TOTALE + 1; r++) {
      if (ws.getCell(r, 3).value !== "Not charged") continue;
      const nota = String(ws.getCell(r, 5).value ?? "");
      if (nota.trim() === "") mute.push(r);
    }
    expect(mute).toEqual([]);
  });
});
