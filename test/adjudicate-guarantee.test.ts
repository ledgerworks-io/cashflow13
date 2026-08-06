import { readFileSync } from "node:fs";

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import {
  REASON_CODES,
  VERDICTS,
  WARNING_CODES,
  adjudicate,
  verdictRow,
  type EmailAdjudication,
} from "../src/adjudicate/verdict.js";
import { generateVerdictReceipt } from "../src/adjudicate/receipt.js";
import { DEFAULT_POLICY, computeCharge } from "../src/adjudicate/billing.js";
import { RECEIPT_KEY } from "../src/adjudicate/platform.js";
import type { Adjudication } from "../src/adjudicate/verdict.js";
import type { FilterRule } from "../src/audit/report.js";

/**
 * Un'aggiudicazione della forma giusta, per ricalcolare le righe pubblicate
 * senza dover costruire migliaia di record veri.
 */
function finto(consegnati: number, aggiudicati: number): Adjudication {
  return {
    records: [],
    summary: {
      total: consegnati,
      good: aggiudicati,
      rejected: 0,
      duplicate: 0,
      undecidable: consegnati - aggiudicati,
      billable: aggiudicati,
      notBillable: consegnati - aggiudicati,
      costPerGoodRecordUsd: null,
    },
  };
}

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
/**
 * Le promesse ritirate, in un posto solo — e sorvegliate su OGNI superficie che
 * il cliente legge.
 *
 * Il 6 agosto 2026 il tetto «metà di quanto dichiari» è stato abolito, ma il
 * 7 la verifica indipendente l'ha ritrovato vivo in due punti: nel README
 * («activates the 50% cap») e nella descrizione di `amountPaidUsd` nello schema
 * di input («never charged more than half of what you declare here»), che è la
 * frase che il cliente ha davanti **mentre digita il numero**.
 *
 * Erano sopravvissute per due ragioni, e sono due lezioni diverse:
 *
 *  1. le vecchie asserzioni cercavano due frasi esatte, non il **concetto**.
 *     «activates the 50% cap» non somigliava a nessuna delle due;
 *  2. **nessun test leggeva `input_schema.json`.** Una dichiarazione
 *     commerciale che nessun test guarda è esattamente il difetto che questo
 *     file esiste per impedire — e stava nel file che il codice non importa.
 *
 * Quindi: un elenco solo, applicato a tutte le superfici. Aggiungere una
 * superficie significa aggiungerla a `SUPERFICI`, non riscrivere le regole.
 */
const PROMESSE_RITIRATE = [
  /half of what you tell us/i,
  /half of what you (paid|declare|spent)/i,
  /\b50\s*%\s*cap\b/i,
  /activates the cap/i,
  /never charged more than half/i,
];

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
    expect(README).toContain(
      `Never more than $${DEFAULT_POLICY.capUsdPer1000Delivered.toFixed(2)} per 1,000 records you gave us`,
    );
  });

  it("la scheda non promette più un tetto legato a quello che il cliente dichiara", () => {
    // Fino al 6 agosto 2026 prometteva «never more than half of what you tell
    // us you paid», e chi dichiarava $0 pagava $0 su record dimostrati. La
    // promessa poggiava sull'onore nel prodotto che si chiama «paghi solo
    // quello che sappiamo dimostrare».
    for (const vietato of PROMESSE_RITIRATE) {
      expect(README, `il README non deve contenere ${vietato}`).not.toMatch(vietato);
    }
  });

  it("ogni riga della tabella sulla scheda si ricalcola dal codice", () => {
    // La tabella «You give us / You pay» è una dichiarazione commerciale: se
    // una riga non discende da `computeCharge`, la scheda dichiara un prezzo
    // che il codice non applica. Le righe si leggono dal README e si
    // ricalcolano, invece di fidarsi che qualcuno le abbia aggiornate.
    const righe = [...README.matchAll(
      /^\| ([\d,]+) \| ([\d,]+) \(\d+%\) \| \$([\d.]+) \| \$([\d.]+) \| \*\*\$([\d.]+)\*\* \|$/gm,
    )];
    expect(righe.length, "la tabella degli esempi deve esistere").toBeGreaterThanOrEqual(4);

    const num = (s: string) => Number(s.replace(/,/g, ""));
    for (const r of righe) {
      const [, cons, agg, listino, tetto, paga] = r;
      const consegnati = num(cons!);
      const aggiudicati = num(agg!);
      const c = computeCharge(
        finto(consegnati, aggiudicati),
        DEFAULT_POLICY,
      );
      const etichetta = `riga «${consegnati} consegnati / ${aggiudicati} aggiudicati»`;
      // La scheda mostra i centesimi, il motore lavora al millesimo di
      // centesimo: si confronta l'arrotondamento, ed è quello che deve tornare.
      const centesimi = (x: number) => Math.round(x * 100) / 100;
      expect(num(listino!), `${etichetta}: colonna listino`).toBe(centesimi(c.grossUsd));
      expect(num(tetto!), `${etichetta}: colonna tetto`).toBe(centesimi(c.capUsd));
      expect(num(paga!), `${etichetta}: colonna «You pay»`).toBe(centesimi(c.totalUsd));
    }
  });

  it("la formula del tetto scritta sulla scheda è quella che il codice applica", () => {
    expect(README).toContain(
      `records you gave us ÷ 1000 × $${DEFAULT_POLICY.capUsdPer1000Delivered.toFixed(2)}`,
    );
    expect(README).toContain(
      `− ${DEFAULT_POLICY.freePerRun} free) × $${DEFAULT_POLICY.pricePerRecordUsd}`,
    );
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

/**
 * Lo schema di input È la scheda del prodotto, tanto quanto il README.
 *
 * Il codice non lo importa mai — lo legge Apify per costruire il modulo — e per
 * questo era rimasto fuori da ogni test fino al 7 agosto 2026, con dentro la
 * vecchia promessa del tetto al 50%. È la superficie su cui il cliente prende
 * la decisione: quello che c'è scritto qui vale quanto quello che fa
 * `computeCharge`.
 */
describe("lo schema di input non dichiara niente che il codice non faccia", () => {
  const GREZZO = readFileSync(
    new URL("../actors/lead-adjudicator/.actor/input_schema.json", import.meta.url),
    "utf8",
  );
  const SCHEMA = JSON.parse(GREZZO) as {
    properties: Record<string, { description?: string; title?: string }>;
  };

  it("non contiene nessuna delle promesse ritirate", () => {
    for (const vietato of PROMESSE_RITIRATE) {
      expect(GREZZO, `lo schema di input non deve contenere ${vietato}`).not.toMatch(vietato);
    }
  });

  it("`amountPaidUsd` dichiara di NON influire sulla fattura", () => {
    // È il punto esatto in cui la vecchia promessa viveva: il campo che il
    // cliente compila credendo di abbassarsi il conto. `computeCharge` non lo
    // riceve nemmeno come parametro — la descrizione deve dirlo.
    const d = SCHEMA.properties["amountPaidUsd"]?.description ?? "";
    expect(d, "amountPaidUsd deve avere una descrizione").not.toBe("");
    expect(d).toMatch(/no effect on what you are charged/i);
  });

  it("`amountPaidUsd` non entra davvero nel calcolo della fattura", () => {
    // La prova che regge la frase qui sopra: a parità di verdetti, qualunque
    // importo dichiarato produce la stessa fattura. Se un giorno rientrasse nel
    // conto, questo cade prima della scheda.
    const g = finto(20_000, 12_700);
    const atteso = computeCharge(g, DEFAULT_POLICY).totalUsd;
    for (const dichiarato of [0, 0.01, 20, 1_000_000]) {
      const conDichiarazione = computeCharge(
        { ...g, summary: { ...g.summary, costPerGoodRecordUsd: dichiarato } },
        DEFAULT_POLICY,
      );
      expect(conDichiarazione.totalUsd, `dichiarando $${dichiarato}`).toBe(atteso);
    }
    // E il vecchio difetto, nominato: chi dichiarava $0 pagava $0.
    expect(atteso).toBeGreaterThan(0);
  });

  it("ogni proprietà ha una descrizione: senza, la build Apify fallisce dopo il clone", () => {
    for (const [nome, p] of Object.entries(SCHEMA.properties)) {
      expect(p.description ?? "", `${nome} senza description`).not.toBe("");
    }
  });
});

/**
 * Lo schema di USCITA dichiara al cliente cosa riceverà. È una promessa come le
 * altre, e ha già un precedente: il DIARIO §8 racconta di uno schema del dataset
 * che dichiarava campi che l'Actor non scriveva mai — «la spunta era verde e il
 * documento mentiva».
 *
 * Questi test lo impediscono confrontando lo schema con `verdictRow()`, che è la
 * funzione che l'attore usa DAVVERO per costruire ogni riga. Non con un elenco
 * copiato a mano: con il codice che produce il dato.
 */
describe("lo schema di uscita dichiara esattamente quello che scriviamo", () => {
  const SCHEMA = JSON.parse(
    readFileSync(
      new URL("../actors/lead-adjudicator/.actor/dataset_schema.json", import.meta.url),
      "utf8",
    ),
  ) as {
    fields: { properties: Record<string, { enum?: string[] }>; required: string[] };
    views: Record<string, { transformation: { fields: string[] } }>;
  };

  const dichiarati = Object.keys(SCHEMA.fields.properties).sort();

  it("i campi dichiarati sono esattamente quelli che l'attore produce", () => {
    const { g } = giudizio();
    const prodotti = [...new Set(g.records.flatMap((r) => Object.keys(verdictRow(r))))].sort();
    // I due versi, entrambi: niente dichiarato-e-mai-scritto (la spunta comprata)
    // e niente scritto-e-mai-dichiarato (il cliente riceve roba non documentata).
    expect(prodotti).toEqual(dichiarati);
    expect(SCHEMA.fields.required.slice().sort()).toEqual(dichiarati);
  });

  it("la vista mostra tutti i campi, senza nasconderne nessuno", () => {
    expect(SCHEMA.views["verdicts"]!.transformation.fields.slice().sort()).toEqual(dichiarati);
  });

  it("i verdetti elencati sono esattamente quelli che il motore sa emettere", () => {
    // `VERDICTS` esiste a runtime apposta per questo genere di controllo.
    expect(SCHEMA.fields.properties["verdict"]!.enum!.slice().sort())
      .toEqual([...VERDICTS].sort());
  });

  it("i codici di ragione e di avviso sono quelli veri", () => {
    const reason = SCHEMA.fields.properties["reasons"] as unknown as {
      items: { properties: { code: { enum: string[] } } };
    };
    expect(reason.items.properties.code.enum.slice().sort()).toEqual([...REASON_CODES].sort());
    const warn = SCHEMA.fields.properties["warnings"] as unknown as {
      items: { properties: { code: { enum: string[] } } };
    };
    expect(warn.items.properties.code.enum.slice().sort()).toEqual([...WARNING_CODES].sort());
  });

  it("«charged» nello schema è la stessa cosa che decide la fattura", () => {
    // Lo schema dice al cliente che gli indecidibili non si pagano. Se un
    // giorno `billable` e `charged` divergessero, la scheda mentirebbe.
    const { g } = giudizio();
    for (const r of g.records) {
      expect(verdictRow(r).charged).toBe(r.billable);
      if (r.verdict === "undecidable") expect(verdictRow(r).charged).toBe(false);
    }
  });
});

/**
 * Lo schema di USCITA (`.actor/output_schema.json`) dice al cliente **dove**
 * trovare quello che ha comprato. È distinto dallo schema del dataset, che dice
 * invece *cosa* c'è in ogni riga: il primo dichiara i recapiti, il secondo il
 * contenuto. Ci sono voluti due tentativi per capirlo, il 7 agosto 2026.
 *
 * Qui il modo di sbagliare è diverso dagli altri: non dichiarare il falso, ma
 * **mandare il cliente a un indirizzo dove non c'è niente.** Se il codice
 * scrivesse la ricevuta sotto un'altra chiave, la scheda punterebbe a un 404
 * proprio sul documento che dimostra la fattura.
 */
describe("lo schema di uscita manda il cliente dove il codice scrive davvero", () => {
  const OUT = JSON.parse(
    readFileSync(
      new URL("../actors/lead-adjudicator/.actor/output_schema.json", import.meta.url),
      "utf8",
    ),
  ) as {
    actorOutputSchemaVersion: number;
    title: string;
    properties: Record<string, { title: string; template: string; description?: string }>;
  };

  it("ha la forma che la piattaforma pretende", () => {
    expect(OUT.actorOutputSchemaVersion).toBe(1);
    expect(OUT.title).not.toBe("");
    for (const [nome, p] of Object.entries(OUT.properties)) {
      expect(p.title, `${nome} senza title`).not.toBe("");
      expect(p.template, `${nome} senza template`).not.toBe("");
    }
  });

  it("dichiara la ricevuta sotto la chiave che il codice usa davvero", () => {
    // `RECEIPT_KEY` è la stessa costante che l'attore passa a `consegna()`.
    expect(OUT.properties["receipt"]!.template).toContain(RECEIPT_KEY);
    expect(OUT.properties["receipt"]!.template).toContain("apiDefaultKeyValueStoreUrl");
  });

  it("dichiara i verdetti nel dataset PREDEFINITO, che è dove li scriviamo", () => {
    // L'attore scrive su ACTOR_DEFAULT_DATASET_ID, non su un dataset con nome:
    // se lo schema puntasse a uno storage con nome, il cliente non troverebbe
    // niente.
    expect(OUT.properties["verdicts"]!.template).toContain("apiDefaultDatasetUrl");
    expect(OUT.properties["verdicts"]!.template).not.toMatch(/storages\./);
  });

  it("le due uscite promesse sono esattamente due, e sono quelle che consegniamo", () => {
    // L'attore fa due consegne: la ricevuta e i verdetti. Nient'altro.
    expect(Object.keys(OUT.properties).sort()).toEqual(["receipt", "verdicts"]);
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
