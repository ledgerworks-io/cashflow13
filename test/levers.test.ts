import { describe, expect, it } from "vitest";
import { computeLevers } from "../src/engine/levers.js";
import { buildPlan, type CashFlowInputs } from "../src/engine/plan.js";

const costante = (v: number) => Array.from({ length: 13 }, () => v);
const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);

/** Va sotto zero alla settimana 4, fabbisogno massimo 121.400. */
const inSofferenza = (over: Partial<CashFlowInputs> = {}): CashFlowInputs => ({
  startDate: utc("2026-08-05"),
  openingBalance: 45_000,
  receipts: costante(28_000),
  supplierPayments: costante(19_000),
  payroll: costante(14_500),
  loanRepayments: costante(3_200),
  taxes: costante(4_100),
  ...over,
});

const leva = (id: string, input = inSofferenza()) => {
  const l = computeLevers(input, buildPlan(input)).find((x) => x.id === id);
  if (!l) throw new Error(`leva ${id} non trovata`);
  return l;
};

describe("quali leve escono", () => {
  it("ne calcola tre", () => {
    const input = inSofferenza();
    const ids = computeLevers(input, buildPlan(input)).map((l) => l.id);
    expect(ids).toEqual(["collect-earlier", "pay-later", "shift-payroll"]);
  });

  it("non tocca gli ingressi originali", () => {
    const input = inSofferenza();
    const copia = JSON.parse(JSON.stringify({ ...input, startDate: null }));
    computeLevers(input, buildPlan(input));
    expect(JSON.parse(JSON.stringify({ ...input, startDate: null }))).toEqual(copia);
  });
});

describe("incassare prima", () => {
  it("libera cassa e migliora il fabbisogno massimo", () => {
    const l = leva("collect-earlier");
    expect(l.peakFundingDelta).toBeLessThan(0);
    expect(l.peakFundingNeed).toBeLessThan(121_400);
  });

  it("libera circa incassi giornalieri per i giorni guadagnati", () => {
    // 28.000/settimana = 4.000/giorno; 15 giorni ≈ 60.000.
    const l = leva("collect-earlier");
    expect(121_400 - l.peakFundingNeed).toBeCloseTo(60_000, 0);
  });

  it("sposta più in là la settimana di rottura", () => {
    const l = leva("collect-earlier");
    expect(l.firstNegativeWeek).toBeGreaterThan(4);
    expect(l.weeksGained).toBeGreaterThan(0);
  });
});

describe("pagare dopo", () => {
  it("trattiene cassa e migliora il fabbisogno", () => {
    const l = leva("pay-later");
    expect(l.peakFundingDelta).toBeLessThan(0);
  });

  it("vale circa i pagamenti giornalieri per i giorni di dilazione", () => {
    // 19.000/settimana ≈ 2.714/giorno; 15 giorni ≈ 40.714.
    const l = leva("pay-later");
    expect(121_400 - l.peakFundingNeed).toBeCloseTo(40_714, -2);
  });
});

describe("spostare gli stipendi", () => {
  it("la prima settimana non ha stipendi", () => {
    const l = leva("shift-payroll");
    expect(l.weeks[0]!.payroll).toBe(0);
  });

  it("ogni settimana eredita gli stipendi della precedente", () => {
    const l = leva("shift-payroll");
    for (let i = 1; i < 13; i++) expect(l.weeks[i]!.payroll).toBe(14_500);
  });

  it("dichiara che un pagamento esce dall'orizzonte, non che sparisce", () => {
    // Onesta' obbligatoria: il tredicesimo stipendio si paga in settimana 14.
    // Farlo passare per un risparmio sarebbe un numero falso.
    const l = leva("shift-payroll");
    expect(l.movesBeyondHorizon).toBe(true);
  });
});

describe("quando la leva risolve il problema", () => {
  it("dichiara che la cassa non va più sotto zero", () => {
    // Con 110.000 di apertura lo scoperto di periodo è 56.400, e quindici
    // giorni di incassi ne liberano 60.000: la leva basta. Con 100.000 no
    // (66.400 di buco contro 60.000 liberati) — il margine è stretto e va
    // scelto di proposito, non a occhio.
    const input = inSofferenza({ openingBalance: 110_000 });
    const l = computeLevers(input, buildPlan(input))
      .find((x) => x.id === "collect-earlier")!;
    expect(l.avoidsShortfall).toBe(true);
    expect(l.firstNegativeWeek).toBeNull();
    expect(l.peakFundingNeed).toBe(0);
  });

  it("su un piano già sano nessuna leva promette miglioramenti inventati", () => {
    const input = inSofferenza({ openingBalance: 900_000 });
    for (const l of computeLevers(input, buildPlan(input))) {
      expect(l.peakFundingNeed).toBe(0);
      expect(l.avoidsShortfall).toBe(false); // non c'era niente da evitare
    }
  });
});

describe("giorni configurabili", () => {
  it("più giorni liberano più cassa", () => {
    const input = inSofferenza();
    const base = buildPlan(input);
    const a = computeLevers(input, base, { collectDaysEarlier: 7 })[0]!;
    const b = computeLevers(input, base, { collectDaysEarlier: 30 })[0]!;
    expect(b.peakFundingNeed).toBeLessThan(a.peakFundingNeed);
  });

  it("zero giorni non cambia niente", () => {
    const input = inSofferenza();
    const base = buildPlan(input);
    const l = computeLevers(input, base, { collectDaysEarlier: 0 })[0]!;
    expect(l.peakFundingNeed).toBe(base.peakFundingNeed);
    expect(l.peakFundingDelta).toBe(0);
  });
});
