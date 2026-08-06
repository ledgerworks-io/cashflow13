import { describe, expect, it } from "vitest";

import { adjudicate, type EmailAdjudication } from "../src/adjudicate/verdict.js";
import {
  DEFAULT_POLICY,
  computeCharge,
  priceFromPricingInfo,
  type BillingPolicy,
} from "../src/adjudicate/billing.js";
import type { FilterRule } from "../src/audit/report.js";

/**
 * Il conto da presentare.
 *
 * Tre promesse, e sono tutte e tre dichiarazioni commerciali: se il codice non
 * le rispetta non è un difetto, è pubblicità ingannevole.
 *
 *   1. non si addebita un record che non abbiamo aggiudicato;
 *   2. i primi 200 record aggiudicati di OGNI esecuzione sono gratuiti;
 *   3. non si addebita mai più della metà di quanto il cliente dichiara di
 *      aver speso per i dati.
 *
 * I numeri stanno in `DEFAULT_POLICY` e in nessun altro posto: la scheda del
 * prodotto e il codice devono dire la stessa cosa, e un test lo verifica.
 */

const INDECIDIBILE: EmailAdjudication = {
  verdict: "undecidable",
  reason: "casella non verificabile senza SMTP",
};
const criteri: FilterRule[] = [{ field: "regione", op: "equals", value: "Lombardia" }];

/** `aggiudicati` record certi + `indecidibili` record che NON si possono addebitare. */
function giudizio(aggiudicati: number, indecidibili = 0) {
  const righe = [
    ...Array.from({ length: aggiudicati }, (_, i) => ({
      id: `ok${i}`, regione: "Lombardia", email: `x${i}@azienda.com`,
    })),
    ...Array.from({ length: indecidibili }, (_, i) => ({
      id: `boh${i}`, regione: "Lombardia", email: `y${i}@azienda.com`,
    })),
  ];
  return adjudicate(righe, {
    dedupeKeys: ["id"],
    filters: criteri,
    emailField: "email",
    emailLookup: (a) => (a.startsWith("y") ? INDECIDIBILE : { verdict: "deliverable" }),
  });
}

describe("i numeri pubblicati stanno in un posto solo", () => {
  it("la scheda dice $0,005, primi 200 gratis, tetto al 50% — e il codice deve dire lo stesso", () => {
    expect(DEFAULT_POLICY.pricePerRecordUsd).toBe(0.005);
    expect(DEFAULT_POLICY.freePerRun).toBe(200);
    expect(DEFAULT_POLICY.capFractionOfDeclaredSpend).toBe(0.5);
  });
});

describe("il prezzo vive in due posti, e devono coincidere", () => {
  // Forma vera, copiata da una risposta di /v2/store del 6 agosto 2026.
  const VERA = {
    pricingModel: "PAY_PER_EVENT",
    pricingPerEvent: {
      actorChargeEvents: {
        "record-adjudicated": {
          eventTitle: "Adjudicated record",
          eventTieredPricingUsd: {
            FREE: { tieredEventPriceUsd: 0.005 },
            BRONZE: { tieredEventPriceUsd: 0.004 },
            DIAMOND: { tieredEventPriceUsd: 0.001 },
          },
        },
      },
    },
  };

  it("legge la fascia FREE, che è la più alta e quella che paga la maggioranza", () => {
    // Mettere in vetrina la fascia più bassa è la mossa che nelle recensioni
    // viene chiamata «bait-and-switch». Si dichiara la più alta.
    expect(priceFromPricingInfo(VERA, "record-adjudicated")).toBe(0.005);
  });

  it("quello che pubblichiamo coincide con quello che il codice usa", () => {
    expect(priceFromPricingInfo(VERA, "record-adjudicated")).toBe(
      DEFAULT_POLICY.pricePerRecordUsd,
    );
  });

  it("regge anche il prezzo piatto, senza fasce", () => {
    const piatto = {
      pricingPerEvent: { actorChargeEvents: { ev: { eventPriceUsd: 0.02 } } },
    };
    expect(priceFromPricingInfo(piatto, "ev")).toBe(0.02);
  });

  it("se non sa leggerlo dice null, invece di inventare un numero", () => {
    expect(priceFromPricingInfo(null, "ev")).toBeNull();
    expect(priceFromPricingInfo({}, "ev")).toBeNull();
    expect(priceFromPricingInfo(VERA, "evento-che-non-esiste")).toBeNull();
    expect(priceFromPricingInfo(
      { pricingPerEvent: { actorChargeEvents: { ev: {} } } }, "ev",
    )).toBeNull();
  });
});

describe("promessa 1 — non si addebita quello che non si è aggiudicato", () => {
  it("gli indecidibili non entrano nel conto, nemmeno di striscio", () => {
    const conSoloBuoni = computeCharge(giudizio(1_000), DEFAULT_POLICY);
    const conMilleIgnoti = computeCharge(giudizio(1_000, 1_000), DEFAULT_POLICY);
    expect(conMilleIgnoti.totalUsd).toBe(conSoloBuoni.totalUsd);
  });

  it("un'esecuzione fatta solo di indecidibili non costa niente", () => {
    const c = computeCharge(giudizio(0, 5_000), DEFAULT_POLICY);
    expect(c.adjudicated).toBe(0);
    expect(c.totalUsd).toBe(0);
  });
});

describe("promessa 2 — i primi 200 aggiudicati sono gratuiti, sempre", () => {
  it("esattamente 200 aggiudicati: non si paga niente", () => {
    const c = computeCharge(giudizio(200), DEFAULT_POLICY);
    expect(c.free).toBe(200);
    expect(c.chargeable).toBe(0);
    expect(c.totalUsd).toBe(0);
  });

  it("il 201° è il primo che si paga, e si paga uno solo", () => {
    const c = computeCharge(giudizio(201), DEFAULT_POLICY);
    expect(c.chargeable).toBe(1);
    expect(c.totalUsd).toBeCloseTo(0.005, 10);
  });

  it("sotto la soglia la quota non diventa un credito", () => {
    const c = computeCharge(giudizio(10), DEFAULT_POLICY);
    expect(c.free).toBe(10);
    expect(c.chargeable).toBe(0);
    expect(c.totalUsd).toBe(0);
  });

  it("la quota vale per OGNI esecuzione: due da 200 non fanno 400 a pagamento", () => {
    const a = computeCharge(giudizio(200), DEFAULT_POLICY);
    const b = computeCharge(giudizio(200), DEFAULT_POLICY);
    expect(a.totalUsd + b.totalUsd).toBe(0);
  });
});

describe("promessa 3 — mai più della metà di quanto ha speso per i dati", () => {
  it("nel caso normale il tetto non scatta e non toglie niente", () => {
    // 5.000 record, 35% aggiudicabile, dati pagati $20 → tetto $10, conto ~$8
    const c = computeCharge(giudizio(1_750, 3_250), DEFAULT_POLICY, 20);
    expect(c.capApplied).toBe(false);
    expect(c.totalUsd).toBeCloseTo((1_750 - 200) * 0.005, 10);
  });

  it("nel caso brutto scatta e il cliente non paga più della metà", () => {
    // Tutto aggiudicabile: senza tetto costerebbe più dei dati stessi.
    const c = computeCharge(giudizio(5_000), DEFAULT_POLICY, 20);
    expect(c.grossUsd).toBeCloseTo(24, 10);
    expect(c.capApplied).toBe(true);
    expect(c.totalUsd).toBe(10);
  });

  it("senza importo dichiarato non c'è tetto, e non se ne inventa uno", () => {
    const c = computeCharge(giudizio(5_000), DEFAULT_POLICY);
    expect(c.capUsd).toBeNull();
    expect(c.capApplied).toBe(false);
    expect(c.totalUsd).toBeCloseTo(24, 10);
  });

  it("un importo dichiarato assurdo non apre un buco nel conto", () => {
    for (const brutto of [-5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const c = computeCharge(giudizio(1_000), DEFAULT_POLICY, brutto);
      expect(c.totalUsd, String(brutto)).toBeCloseTo((1_000 - 200) * 0.005, 10);
      expect(c.capApplied, String(brutto)).toBe(false);
    }
  });

  it("dati dichiarati a zero: il tetto è zero e il conto è zero", () => {
    const c = computeCharge(giudizio(5_000), DEFAULT_POLICY, 0);
    expect(c.totalUsd).toBe(0);
    expect(c.capApplied).toBe(true);
  });
});

describe("il tetto della piattaforma — che l'API NON fa rispettare da sola", () => {
  // Dalla risposta 201 di POST /v2/actor-runs/{runId}/charge, testuale:
  // «the API does not check this. Above the limit, the charges reported as
  // successful in API will not be added to your payouts, but you will still
  // bear the associated costs.» Addebitare oltre il tetto non è un errore
  // dell'utente: è lavoro regalato e calcolo pagato.
  it("non si addebita mai oltre il massimo dichiarato dalla piattaforma", () => {
    const c = computeCharge(giudizio(5_000), DEFAULT_POLICY, undefined, 3);
    expect(c.grossUsd).toBeCloseTo(24, 10);
    expect(c.platformCapApplied).toBe(true);
    expect(c.totalUsd).toBe(3);
  });

  it("se il tetto della piattaforma è più alto del conto, non tocca niente", () => {
    const c = computeCharge(giudizio(1_000), DEFAULT_POLICY, undefined, 1_000);
    expect(c.platformCapApplied).toBe(false);
    expect(c.totalUsd).toBeCloseTo(4, 10);
  });

  it("vince sempre il più basso fra i due tetti", () => {
    // dichiarato $20 → tetto nostro $10; piattaforma $2 → vince $2
    const c = computeCharge(giudizio(5_000), DEFAULT_POLICY, 20, 2);
    expect(c.totalUsd).toBe(2);
    expect(c.platformCapApplied).toBe(true);
  });

  it("un tetto di piattaforma assurdo o assente non apre un buco", () => {
    for (const brutto of [undefined, Number.NaN, -1]) {
      const c = computeCharge(giudizio(1_000), DEFAULT_POLICY, undefined, brutto);
      expect(c.totalUsd, String(brutto)).toBeCloseTo(4, 10);
    }
  });
});

describe("l'invariante che tiene insieme le tre promesse", () => {
  const politica: BillingPolicy = DEFAULT_POLICY;

  it("il conto non supera mai aggiudicati × prezzo, in nessuna combinazione", () => {
    for (const [ok, boh, speso] of [
      [0, 0, undefined], [50, 500, undefined], [200, 0, 100], [201, 1, 100],
      [5_000, 5_000, 1_000], [10_000, 0, 5], [1, 99_999, 0.01],
    ] as [number, number, number | undefined][]) {
      const c = computeCharge(giudizio(ok, boh), politica, speso);
      expect(c.totalUsd, `${ok}/${boh}/${speso}`).toBeLessThanOrEqual(
        ok * politica.pricePerRecordUsd + 1e-9,
      );
      expect(c.totalUsd, `${ok}/${boh}/${speso}`).toBeGreaterThanOrEqual(0);
      if (speso !== undefined && Number.isFinite(speso) && speso >= 0) {
        expect(c.totalUsd).toBeLessThanOrEqual(speso * politica.capFractionOfDeclaredSpend + 1e-9);
      }
    }
  });

  it("l'aritmetica in virgola mobile non produce centesimi dal nulla", () => {
    const c = computeCharge(giudizio(4_800 + 200), DEFAULT_POLICY);
    expect(c.totalUsd).toBe(24); // non 23.999999999
  });
});

describe("da dollari a eventi — è questo il numero che va ad Apify", () => {
  it("senza tetti, un evento per ogni record a pagamento", () => {
    const c = computeCharge(giudizio(1_000), DEFAULT_POLICY);
    expect(c.billedEvents).toBe(800);
    expect(c.billedEvents * DEFAULT_POLICY.pricePerRecordUsd).toBeCloseTo(c.totalUsd, 10);
  });

  it("la deriva binaria non fa perdere un evento", () => {
    const c = computeCharge(giudizio(5_000), DEFAULT_POLICY);
    expect(c.billedEvents).toBe(4_800); // non 4.799
  });

  it("col tetto si arrotonda per DIFETTO: mai un centesimo di troppo", () => {
    // tetto $3 a $0,005 = 600 eventi esatti; con $3,004 restano 600, non 601
    expect(computeCharge(giudizio(5_000), DEFAULT_POLICY, undefined, 3).billedEvents).toBe(600);
    expect(computeCharge(giudizio(5_000), DEFAULT_POLICY, undefined, 3.004).billedEvents).toBe(600);
  });

  it("gli eventi non superano mai i record a pagamento, in nessun caso", () => {
    for (const [ok, boh, speso, max] of [
      [0, 0, undefined, undefined], [200, 0, 100, 100], [201, 5, 1, 0.5],
      [10_000, 10_000, 10_000, 10_000], [5_000, 0, 0.001, undefined],
    ] as [number, number, number | undefined, number | undefined][]) {
      const c = computeCharge(giudizio(ok, boh), DEFAULT_POLICY, speso, max);
      expect(c.billedEvents).toBeLessThanOrEqual(c.chargeable);
      expect(c.billedEvents).toBeGreaterThanOrEqual(0);
      expect(c.billedEvents * DEFAULT_POLICY.pricePerRecordUsd).toBeLessThanOrEqual(c.totalUsd + 1e-9);
    }
  });
});
