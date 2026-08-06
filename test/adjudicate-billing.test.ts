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
 *   3. non si addebita mai più di $0,75 ogni 1.000 record consegnati.
 *
 * I numeri stanno in `DEFAULT_POLICY` e in nessun altro posto: la scheda del
 * prodotto e il codice devono dire la stessa cosa, e un test lo verifica.
 *
 * La terza promessa è cambiata il 6 agosto 2026. Prima era «metà di quanto
 * dichiari di aver speso», e la verifica indipendente ha misurato che chi
 * dichiarava $0 pagava $0: il numero che decideva la fattura lo digitava il
 * cliente e non era verificabile. Adesso il tetto discende dai record
 * consegnati, che contiamo noi.
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
  it("la scheda dice $0,005, primi 200 gratis, $0,75 ogni 1.000 consegnati — e il codice deve dire lo stesso", () => {
    expect(DEFAULT_POLICY.pricePerRecordUsd).toBe(0.005);
    expect(DEFAULT_POLICY.freePerRun).toBe(200);
    expect(DEFAULT_POLICY.capUsdPer1000Delivered).toBe(0.75);
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
  it("gli indecidibili non entrano MAI nella base imponibile", () => {
    const conSoloBuoni = computeCharge(giudizio(1_000), DEFAULT_POLICY);
    const conMilleIgnoti = computeCharge(giudizio(1_000, 1_000), DEFAULT_POLICY);
    // Stessi aggiudicati, stesso lordo: gli indecidibili non aggiungono un
    // centesimo a quello che si fattura.
    expect(conMilleIgnoti.adjudicated).toBe(conSoloBuoni.adjudicated);
    expect(conMilleIgnoti.chargeable).toBe(conSoloBuoni.chargeable);
    expect(conMilleIgnoti.grossUsd).toBe(conSoloBuoni.grossUsd);
  });

  it("il conto non supera MAI gli aggiudicati a listino, con qualunque zavorra", () => {
    // È questa la forma esatta della promessa 1, e vale in ogni caso.
    for (const [ok, boh] of [[1_000, 0], [1_000, 1_000], [1_000, 99_000]] as [number, number][]) {
      const c = computeCharge(giudizio(ok, boh), DEFAULT_POLICY);
      expect(c.totalUsd, `${ok}/${boh}`)
        .toBeLessThanOrEqual((ok - DEFAULT_POLICY.freePerRun) * DEFAULT_POLICY.pricePerRecordUsd + 1e-9);
    }
  });

  it("aggiungere indecidibili può ALZARE il tetto, e va detto invece che nascosto", () => {
    // Effetto collaterale reale del tetto sui consegnati: una lista più grossa
    // alza il soffitto, quindi toglie sconto. Non è un addebito sugli
    // indecidibili — il lordo resta identico (test qui sopra) — ma il conto
    // può salire, fino al massimo del listino sugli aggiudicati e mai oltre.
    const stretta = computeCharge(giudizio(1_000), DEFAULT_POLICY);
    const larga = computeCharge(giudizio(1_000, 1_000), DEFAULT_POLICY);
    expect(stretta.totalUsd).toBeCloseTo(0.75, 10);  // tetto su 1.000 consegnati
    expect(larga.totalUsd).toBeCloseTo(1.5, 10);     // tetto su 2.000 consegnati
    // Il soffitto assoluto resta il listino sugli aggiudicati: $4,00.
    const enorme = computeCharge(giudizio(1_000, 99_000), DEFAULT_POLICY);
    expect(enorme.totalUsd).toBeCloseTo(4, 10);
    expect(enorme.capApplied).toBe(false);
  });

  it("un'esecuzione fatta solo di indecidibili non costa niente, per quanto grossa", () => {
    const c = computeCharge(giudizio(0, 100_000), DEFAULT_POLICY);
    expect(c.capUsd).toBeCloseTo(75, 10); // il tetto sarebbe alto
    expect(c.totalUsd).toBe(0);           // ma non c'è niente da fatturare
    expect(c.billedEvents).toBe(0);
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

describe("promessa 3 — mai più di $0,75 ogni 1.000 record consegnati", () => {
  it("su una lista B2B il tetto non scatta: comanda il listino", () => {
    // 5.000 consegnati, 875 aggiudicati (17,5%): listino $3,375, tetto $3,75.
    const c = computeCharge(giudizio(875, 4_125), DEFAULT_POLICY);
    expect(c.delivered).toBe(5_000);
    expect(c.capUsd).toBeCloseTo(3.75, 10);
    expect(c.capApplied).toBe(false);
    expect(c.totalUsd).toBeCloseTo((875 - 200) * 0.005, 10);
  });

  it("su una lista pulita scatta, e il conto si ferma alla tariffa", () => {
    // 5.000 consegnati tutti aggiudicabili: il listino nudo farebbe $24.
    const c = computeCharge(giudizio(5_000), DEFAULT_POLICY);
    expect(c.grossUsd).toBeCloseTo(24, 10);
    expect(c.capApplied).toBe(true);
    expect(c.totalUsd).toBeCloseTo(3.75, 10);
  });

  it("il tetto si calcola sui CONSEGNATI, non sugli aggiudicati", () => {
    // Stessi 1.000 aggiudicati, due liste di dimensione molto diversa: il
    // tetto deve seguire la lista, non il nostro tasso di successo.
    const piccola = computeCharge(giudizio(1_000), DEFAULT_POLICY);
    const grande = computeCharge(giudizio(1_000, 19_000), DEFAULT_POLICY);
    expect(piccola.capUsd).toBeCloseTo(0.75, 10);
    expect(grande.capUsd).toBeCloseTo(15, 10);
    expect(piccola.adjudicated).toBe(grande.adjudicated);
  });

  it("è proporzionale, non a migliaia intere: nessun gradino a ogni mille", () => {
    // A scatti, fra 1.000 e 1.001 record il tetto raddoppierebbe.
    const mille = computeCharge(giudizio(1_000), DEFAULT_POLICY);
    const milleUno = computeCharge(giudizio(1_001), DEFAULT_POLICY);
    expect(mille.capUsd).toBeCloseTo(0.75, 10);
    expect(milleUno.capUsd).toBeCloseTo(0.75075, 10);
    expect(milleUno.capUsd - mille.capUsd).toBeLessThan(0.01);
  });

  it("999 consegnati su lista B2B: zero, ma per la QUOTA GRATUITA non per il tetto", () => {
    // 174 aggiudicati, tutti dentro i 200 gratuiti: il listino fa già zero.
    const c = computeCharge(giudizio(174, 825), DEFAULT_POLICY);
    expect(c.delivered).toBe(999);
    expect(c.chargeable).toBe(0);
    expect(c.totalUsd).toBe(0);
    expect(c.capApplied).toBe(false); // non è il tetto ad aver fatto zero
  });

  it("quello che il cliente dichiara non entra più nel conto", () => {
    // Era la falla: dichiarare $0 azzerava la fattura su record dimostrati.
    // Adesso non c'è nessun parametro da dichiarare, e il conto non cambia.
    const c = computeCharge(giudizio(12_700, 7_300), DEFAULT_POLICY);
    expect(c.delivered).toBe(20_000);
    expect(c.totalUsd).toBeCloseTo(15, 10); // 20.000/1000 × 0,75
    expect(c.billedEvents).toBe(3_000);
  });

  it("dataset vuoto: tetto zero, conto zero, nessuna divisione per zero", () => {
    const c = computeCharge(giudizio(0), DEFAULT_POLICY);
    expect(c.delivered).toBe(0);
    expect(c.capUsd).toBe(0);
    expect(c.totalUsd).toBe(0);
    expect(c.billedEvents).toBe(0);
  });

  it("una tariffa assurda non apre un buco: il tetto non va sotto zero", () => {
    const politica: BillingPolicy = { ...DEFAULT_POLICY, capUsdPer1000Delivered: -5 };
    const c = computeCharge(giudizio(5_000), politica);
    expect(c.capUsd).toBe(0);
    expect(c.totalUsd).toBe(0);
  });
});

describe("il tetto della piattaforma — che l'API NON fa rispettare da sola", () => {
  // Dalla risposta 201 di POST /v2/actor-runs/{runId}/charge, testuale:
  // «the API does not check this. Above the limit, the charges reported as
  // successful in API will not be added to your payouts, but you will still
  // bear the associated costs.» Addebitare oltre il tetto non è un errore
  // dell'utente: è lavoro regalato e calcolo pagato.
  it("non si addebita mai oltre il massimo dichiarato dalla piattaforma", () => {
    // 5.000 aggiudicati su 195.000 consegnati: il nostro tetto non morde.
    const c = computeCharge(giudizio(5_000, 190_000), DEFAULT_POLICY, 3);
    expect(c.grossUsd).toBeCloseTo(24, 10);
    expect(c.platformCapApplied).toBe(true);
    expect(c.totalUsd).toBe(3);
  });

  it("se il tetto della piattaforma è più alto del conto, non tocca niente", () => {
    const c = computeCharge(giudizio(1_000, 49_000), DEFAULT_POLICY, 1_000);
    expect(c.platformCapApplied).toBe(false);
    expect(c.totalUsd).toBeCloseTo(4, 10);
  });

  it("vince sempre il più basso fra i due tetti", () => {
    // 5.000 consegnati → tetto nostro $3,75; piattaforma $2 → vince $2
    const c = computeCharge(giudizio(5_000), DEFAULT_POLICY, 2);
    expect(c.capUsd).toBeCloseTo(3.75, 10);
    expect(c.totalUsd).toBe(2);
    expect(c.platformCapApplied).toBe(true);
  });

  it("un tetto di piattaforma assurdo o assente non apre un buco", () => {
    for (const brutto of [undefined, Number.NaN, -1]) {
      const c = computeCharge(giudizio(1_000, 49_000), DEFAULT_POLICY, brutto);
      expect(c.totalUsd, String(brutto)).toBeCloseTo(4, 10);
    }
  });
});

describe("l'invariante che tiene insieme le tre promesse", () => {
  const politica: BillingPolicy = DEFAULT_POLICY;

  it("le tre promesse valgono TUTTE INSIEME, in ogni combinazione", () => {
    for (const [ok, boh] of [
      [0, 0], [50, 500], [200, 0], [201, 1],
      [5_000, 5_000], [10_000, 0], [1, 99_999], [63_500, 36_500],
    ] as [number, number][]) {
      const c = computeCharge(giudizio(ok, boh), politica);
      const etichetta = `${ok}/${boh}`;
      // 1: mai più di quanto valgono i soli record aggiudicati
      expect(c.totalUsd, etichetta).toBeLessThanOrEqual(ok * politica.pricePerRecordUsd + 1e-9);
      // 2: la quota gratuita non si paga mai
      expect(c.totalUsd, etichetta)
        .toBeLessThanOrEqual(Math.max(0, ok - politica.freePerRun) * politica.pricePerRecordUsd + 1e-9);
      // 3: mai oltre la tariffa sui consegnati
      expect(c.totalUsd, etichetta)
        .toBeLessThanOrEqual((ok + boh) / 1000 * politica.capUsdPer1000Delivered + 1e-9);
      expect(c.totalUsd, etichetta).toBeGreaterThanOrEqual(0);
    }
  });

  it("l'aritmetica in virgola mobile non produce centesimi dal nulla", () => {
    // 5.000 aggiudicati su 200.000 consegnati: il tetto ($150) non morde, e il
    // listino deve fare esattamente 24, non 23,999999999.
    const c = computeCharge(giudizio(4_800 + 200, 195_000), DEFAULT_POLICY);
    expect(c.capApplied).toBe(false);
    expect(c.totalUsd).toBe(24);
  });
});

describe("da dollari a eventi — è questo il numero che va ad Apify", () => {
  it("senza tetti, un evento per ogni record a pagamento", () => {
    // 1.000 aggiudicati su 50.000 consegnati: il tetto ($37,50) non morde.
    const c = computeCharge(giudizio(1_000, 49_000), DEFAULT_POLICY);
    expect(c.capApplied).toBe(false);
    expect(c.billedEvents).toBe(800);
    expect(c.billedEvents * DEFAULT_POLICY.pricePerRecordUsd).toBeCloseTo(c.totalUsd, 10);
  });

  it("la deriva binaria non fa perdere un evento", () => {
    const c = computeCharge(giudizio(5_000, 195_000), DEFAULT_POLICY);
    expect(c.billedEvents).toBe(4_800); // non 4.799
  });

  it("col tetto si arrotonda per DIFETTO: mai un centesimo di troppo", () => {
    // tetto della piattaforma $3 a $0,005 = 600 eventi esatti; con $3,004
    // restano 600, non 601.
    expect(computeCharge(giudizio(5_000, 195_000), DEFAULT_POLICY, 3).billedEvents).toBe(600);
    expect(computeCharge(giudizio(5_000, 195_000), DEFAULT_POLICY, 3.004).billedEvents).toBe(600);
  });

  it("anche il tetto NOSTRO si arrotonda per difetto", () => {
    // 5.000 consegnati tutti aggiudicati: tetto $3,75 = 750 eventi esatti.
    const c = computeCharge(giudizio(5_000), DEFAULT_POLICY);
    expect(c.billedEvents).toBe(750);
    expect(c.billedEvents * DEFAULT_POLICY.pricePerRecordUsd).toBeLessThanOrEqual(c.totalUsd + 1e-9);
  });

  it("gli eventi non superano mai i record a pagamento, in nessun caso", () => {
    for (const [ok, boh, max] of [
      [0, 0, undefined], [200, 0, 100], [201, 5, 0.5],
      [10_000, 10_000, 10_000], [5_000, 0, undefined], [63_500, 36_500, 1],
    ] as [number, number, number | undefined][]) {
      const c = computeCharge(giudizio(ok, boh), DEFAULT_POLICY, max);
      expect(c.billedEvents).toBeLessThanOrEqual(c.chargeable);
      expect(c.billedEvents).toBeGreaterThanOrEqual(0);
      expect(c.billedEvents * DEFAULT_POLICY.pricePerRecordUsd).toBeLessThanOrEqual(c.totalUsd + 1e-9);
    }
  });
});
