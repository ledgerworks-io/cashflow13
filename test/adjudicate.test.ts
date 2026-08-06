import { describe, expect, it } from "vitest";
import {
  REASON_CODES,
  VERDICTS,
  WARNING_CODES,
  adjudicate,
  type EmailAdjudication,
} from "../src/adjudicate/verdict.js";
import type { FilterRule } from "../src/audit/report.js";
import { STRINGS } from "../src/i18n/strings.js";

/**
 * L'aggiudicatore.
 *
 * Il revisore (`src/audit/report.ts`) risponde «quanto di quello che hai pagato
 * era quello che avevi chiesto», e lo fa in aggregato. Qui si scende di un
 * livello: **verdetto riga per riga, con la ragione**, perché il cliente deve
 * poter tornare nel suo file e vedere QUALE record è stato scartato e perché.
 *
 * E c'è la regola che è il prodotto, non un dettaglio implementativo:
 * **si fattura solo quello che si riesce ad aggiudicare.** Se non sappiamo
 * decidere, non si addebita. È l'esatto opposto della lamentela più ricorrente
 * del negozio (23% delle recensioni negative, DIARIO §11): «mi hai fatto pagare
 * per output che non rispetta il criterio che avevo dichiarato».
 *
 * I casi qui sotto vengono dalle recensioni vere raccolte il 6 agosto 2026,
 * non da ipotesi.
 */

/** Una lista come quelle che arrivano davvero: doppioni, vuoti, fuori filtro. */
const righe = [
  { id: "a", email: "mario@example.com", regione: "Lombardia" },
  { id: "b", email: "", regione: "Lombardia" },
  { id: "c", email: "info@example.com", regione: "Lazio" },
  { id: "a", email: "mario@example.com", regione: "Lombardia" }, // doppione di 0
];

const soloLombardia: FilterRule[] = [{ field: "regione", op: "equals", value: "Lombardia" }];
const emailPiena: FilterRule[] = [{ field: "email", op: "nonEmpty" }];

describe("un verdetto per ogni riga, non un totale", () => {
  it("restituisce un verdetto per ciascuna riga consegnata", () => {
    const r = adjudicate(righe, { dedupeKeys: ["id"] });
    expect(r.records).toHaveLength(4);
  });

  it("conserva la posizione originale: il cliente deve ritrovare la riga nel suo file", () => {
    const r = adjudicate(righe, { dedupeKeys: ["id"] });
    expect(r.records.map((x) => x.index)).toEqual([0, 1, 2, 3]);
  });

  it("una riga che rispetta tutto è buona e non ha ragioni da dare", () => {
    const r = adjudicate(righe, { dedupeKeys: ["id"], filters: soloLombardia });
    expect(r.records[0]?.verdict).toBe("good");
    expect(r.records[0]?.reasons).toEqual([]);
  });

  it("una riga scartata dice QUALE campo l'ha fatta scartare", () => {
    const r = adjudicate(righe, { dedupeKeys: ["id"], filters: soloLombardia });
    const scartata = r.records[2]; // Lazio
    expect(scartata?.verdict).toBe("rejected");
    expect(scartata?.reasons[0]).toMatchObject({ code: "filter", field: "regione" });
  });

  it("un campo vuoto è una ragione con un nome proprio, non un filtro generico", () => {
    const r = adjudicate(righe, { dedupeKeys: ["id"], filters: emailPiena });
    expect(r.records[1]?.reasons[0]).toMatchObject({ code: "empty", field: "email" });
  });

  it("elenca TUTTE le ragioni, non si ferma alla prima", () => {
    const filtri: FilterRule[] = [...soloLombardia, ...emailPiena];
    const r = adjudicate([{ id: "z", email: "", regione: "Lazio" }], {
      dedupeKeys: ["id"],
      filters: filtri,
    });
    expect(r.records[0]?.reasons.map((x) => x.field).sort()).toEqual(["email", "regione"]);
  });
});

describe("duplicati", () => {
  it("la prima occorrenza si giudica, le successive sono doppioni", () => {
    const r = adjudicate(righe, { dedupeKeys: ["id"] });
    expect(r.records[0]?.verdict).toBe("good");
    expect(r.records[3]?.verdict).toBe("duplicate");
  });

  it("il doppione dice di quale riga è doppione: senza, il cliente non può controllare", () => {
    const r = adjudicate(righe, { dedupeKeys: ["id"] });
    expect(r.records[3]?.reasons[0]).toMatchObject({ code: "duplicate", firstSeenAt: 0 });
  });

  it("il doppione è fatturabile: dimostrarlo è lavoro fatto e verificabile", () => {
    const r = adjudicate(righe, { dedupeKeys: ["id"] });
    expect(r.records[3]?.billable).toBe(true);
  });

  it("il caso delle recensioni: risposte finte tutte uguali collassano in doppioni", () => {
    // «returns dummy response while still charging: [{"demo":true} x10]»
    const finti = Array.from({ length: 10 }, () => ({ demo: true }));
    const r = adjudicate(finti, {});
    expect(r.summary.duplicate).toBe(9);
    expect(r.summary.good).toBe(1);
  });

  it("due righe diverse non collassano perché i campi si toccano al confine", () => {
    // Un doppione dichiarato per sbaglio è un record addebitato che il cliente
    // non ha ricevuto due volte: la deduplica non deve MAI confondere due
    // righe distinte, per quanto i valori si somiglino a cavallo del
    // separatore usato per costruire la chiave.
    const insidiose = [
      { a: "x", b: "y z" },
      { a: "x y", b: "z" },
      { a: 1, b: 23 },
      { a: 12, b: 3 },
      { a: "1", b: "23" },
      { a: null, b: undefined },
      { a: undefined, b: null },
    ];
    const r = adjudicate(insidiose, { dedupeKeys: ["a", "b"] });
    expect(r.summary.duplicate).toBe(0);
    expect(r.summary.total).toBe(insidiose.length);
  });

  it("due righe davvero uguali collassano lo stesso", () => {
    // L'altro verso: senza questo, «non deduplicare mai» passerebbe il test
    // qui sopra.
    const uguali = [
      { a: "x", b: "y z" },
      { a: "x", b: "y z" },
    ];
    expect(adjudicate(uguali, { dedupeKeys: ["a", "b"] }).summary.duplicate).toBe(1);
  });
});

describe("la regola di fatturazione: si paga solo quello che si aggiudica", () => {
  /** L'email è l'unica colonna che può restare indecidibile: la 25 è chiusa. */
  const indecidibile: EmailAdjudication = {
    verdict: "undecidable",
    reason: "dominio valido; casella non verificabile senza SMTP",
  };
  const morta: EmailAdjudication = {
    verdict: "undeliverable",
    reason: "il dominio non esiste",
  };

  it("se ogni criterio è decidibile, ogni riga è fatturabile", () => {
    const r = adjudicate(righe, { dedupeKeys: ["id"], filters: soloLombardia });
    expect(r.records.every((x) => x.billable)).toBe(true);
  });

  it("se l'unico criterio è indecidibile, la riga NON è fatturabile", () => {
    const r = adjudicate([{ email: "tizio@azienda.com" }], {
      emailField: "email",
      emailLookup: () => indecidibile,
    });
    expect(r.records[0]?.verdict).toBe("undecidable");
    expect(r.records[0]?.billable).toBe(false);
  });

  it("una riga bocciata da un criterio CERTO resta fatturabile anche se l'email è indecidibile", () => {
    // Il verdetto finale non dipende dal criterio indecidibile: è già deciso.
    // Questo è il punto sottile di tutta la regola.
    const r = adjudicate([{ email: "tizio@azienda.com", regione: "Lazio" }], {
      filters: soloLombardia,
      emailField: "email",
      emailLookup: () => indecidibile,
    });
    expect(r.records[0]?.verdict).toBe("rejected");
    expect(r.records[0]?.billable).toBe(true);
  });

  it("una riga che passa tutto il decidibile ma ha l'email indecidibile NON è fatturabile", () => {
    // «Buona» non è dimostrato: manca un pezzo. Non si addebita.
    const r = adjudicate([{ email: "tizio@azienda.com", regione: "Lombardia" }], {
      filters: soloLombardia,
      emailField: "email",
      emailLookup: () => indecidibile,
    });
    expect(r.records[0]?.verdict).toBe("undecidable");
    expect(r.records[0]?.billable).toBe(false);
  });

  it("un'email dimostrata morta è un verdetto certo, quindi fatturabile", () => {
    const r = adjudicate([{ email: "tizio@dominio-morto.invalid" }], {
      emailField: "email",
      emailLookup: () => morta,
    });
    expect(r.records[0]?.verdict).toBe("rejected");
    expect(r.records[0]?.reasons[0]).toMatchObject({ code: "email", field: "email" });
    expect(r.records[0]?.billable).toBe(true);
  });

  it("senza fornire un modo per giudicare le email, la colonna non esiste e non blocca niente", () => {
    const r = adjudicate([{ email: "tizio@azienda.com", regione: "Lombardia" }], {
      filters: soloLombardia,
    });
    expect(r.records[0]?.verdict).toBe("good");
    expect(r.records[0]?.billable).toBe(true);
  });
});

describe("il conto finale", () => {
  it("separa quello che si fattura da quello che non si fattura", () => {
    const r = adjudicate(
      [
        { email: "a@b.com", regione: "Lombardia" }, // indecidibile -> gratis
        { email: "c@d.com", regione: "Lazio" }, // scartata certa -> si fattura
      ],
      {
        filters: soloLombardia,
        emailField: "email",
        emailLookup: () => ({ verdict: "undecidable", reason: "senza SMTP" }),
      },
    );
    expect(r.summary.billable).toBe(1);
    expect(r.summary.notBillable).toBe(1);
  });

  it("il costo per record utile è quello vero, non quello dichiarato", () => {
    const r = adjudicate(righe, {
      dedupeKeys: ["id"],
      filters: emailPiena,
      amountPaidUsd: 10,
    });
    expect(r.summary.good).toBe(2); // mario e info@, l'email vuota no, il doppione no
    expect(r.summary.costPerGoodRecordUsd).toBeCloseTo(5);
  });

  it("zero righe buone non diventa una divisione per zero", () => {
    const r = adjudicate(righe, {
      filters: [{ field: "regione", op: "equals", value: "Molise" }],
      amountPaidUsd: 10,
    });
    expect(r.summary.good).toBe(0);
    expect(r.summary.costPerGoodRecordUsd).toBeNull();
  });

  it("senza importo dichiarato non inventa un costo", () => {
    expect(adjudicate(righe, {}).summary.costPerGoodRecordUsd).toBeNull();
  });

  it("i conteggi tornano sempre: buone + scartate + doppie + indecidibili = totale", () => {
    const s = adjudicate(righe, { dedupeKeys: ["id"], filters: emailPiena }).summary;
    expect(s.good + s.rejected + s.duplicate + s.undecidable).toBe(s.total);
  });
});

describe("quello che non deve far esplodere niente", () => {
  it("un dataset vuoto", () => {
    const r = adjudicate([], { dedupeKeys: ["id"], amountPaidUsd: 5 });
    expect(r.records).toEqual([]);
    expect(r.summary.total).toBe(0);
    expect(r.summary.costPerGoodRecordUsd).toBeNull();
  });

  it("righe che non sono oggetti: capita davvero quando l'attore sbaglia", () => {
    const r = adjudicate(["testo", null, 42], { filters: emailPiena });
    expect(r.records).toHaveLength(3);
    expect(r.records.every((x) => x.verdict === "rejected")).toBe(true);
  });

  it("un campo email assente non è indecidibile: è assente, e si sa con certezza", () => {
    const r = adjudicate([{ regione: "Lombardia" }], {
      emailField: "email",
      emailLookup: () => ({ verdict: "undecidable", reason: "mai chiamata" }),
    });
    expect(r.records[0]?.verdict).toBe("rejected");
    expect(r.records[0]?.billable).toBe(true);
  });

  it("nessun verdetto o ragione esce senza un'etichetta tradotta", () => {
    // Un codice che il motore sa emettere ma che nessuno sa mostrare è
    // esattamente la «spunta verde comprata con una dichiarazione falsa»:
    // il rapporto direbbe una cosa che il prodotto non è in grado di dire.
    const mancanti = [
      ...VERDICTS.map((v) => `verdict.${v}`),
      ...REASON_CODES.map((c) => `reason.${c}`),
      ...WARNING_CODES.map((c) => `warning.${c}`),
    ].filter((k) => !(k in STRINGS));
    expect(mancanti).toEqual([]);
  });

  it("non chiama il giudizio email quando il campo è vuoto: niente rete sprecata", () => {
    let chiamate = 0;
    adjudicate([{ email: "" }, { email: "   " }], {
      emailField: "email",
      emailLookup: () => {
        chiamate += 1;
        return { verdict: "undecidable", reason: "-" };
      },
    });
    expect(chiamate).toBe(0);
  });
});
