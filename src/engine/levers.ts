import { WEEKS_IN_PLAN } from "./calendar.js";
import { buildPlan, type CashFlowInputs, type CashFlowPlan, type WeekRow } from "./plan.js";

/**
 * Le leve: non "cosa succede", ma "cosa puoi farci".
 *
 * Chi apre lo strumento sa gia' di essere in difficolta'. Il valore sta nel
 * dire quali mosse spostano la data, e di quanto. Tre leve, quelle che un
 * direttore finanziario ha davvero in mano nel giro di due settimane:
 * incassare prima, pagare dopo, spostare gli stipendi.
 *
 * Regola di onesta': una leva non deve mai far sparire un'uscita. Spostare gli
 * stipendi di una settimana spinge l'ultimo pagamento oltre la tredicesima —
 * e questo va DETTO, non incassato come risparmio.
 */

export interface LeverOptions {
  collectDaysEarlier?: number;
  payDaysLater?: number;
  payrollShiftWeeks?: number;
}

export interface Lever {
  id: "collect-earlier" | "pay-later" | "shift-payroll";
  /** Chiave nella tabella di localizzazione. */
  labelKey: string;
  days: number;
  firstNegativeWeek: number | null;
  peakFundingNeed: number;
  /** Negativo = migliora. */
  peakFundingDelta: number;
  /** Settimane guadagnate prima della rottura; null se non c'era o non cambia. */
  weeksGained: number | null;
  /** La leva da sola basta a non andare sotto zero. */
  avoidsShortfall: boolean;
  /** Un'uscita finisce oltre la tredicesima settimana: non e' un risparmio. */
  movesBeyondHorizon: boolean;
  weeks: WeekRow[];
}

const PREDEFINITI: Required<LeverOptions> = {
  collectDaysEarlier: 15,
  payDaysLater: 15,
  payrollShiftWeeks: 1,
};

const media = (v: number[]): number => v.reduce((a, b) => a + b, 0) / v.length;

/**
 * Una tantum di cassa spalmata sulle prime settimane della transizione.
 * Incassare 15 giorni prima non fa arrivare tutto lunedi': il portafoglio si
 * accorcia lungo quei 15 giorni.
 */
function spalma(serie: number[], totale: number, giorni: number): number[] {
  const out = [...serie];
  if (totale === 0 || giorni <= 0) return out;
  const settimane = Math.min(WEEKS_IN_PLAN, Math.max(1, Math.ceil(giorni / 7)));
  const quota = totale / settimane;
  for (let i = 0; i < settimane; i++) out[i] = out[i]! + quota;
  return out;
}

function confronta(
  id: Lever["id"],
  labelKey: string,
  days: number,
  base: CashFlowPlan,
  modificato: CashFlowPlan,
  movesBeyondHorizon: boolean,
): Lever {
  const weeksGained =
    base.firstNegativeWeek === null
      ? null
      : modificato.firstNegativeWeek === null
        ? WEEKS_IN_PLAN - base.firstNegativeWeek + 1
        : modificato.firstNegativeWeek - base.firstNegativeWeek;

  return {
    id,
    labelKey,
    days,
    firstNegativeWeek: modificato.firstNegativeWeek,
    peakFundingNeed: modificato.peakFundingNeed,
    peakFundingDelta: Math.round((modificato.peakFundingNeed - base.peakFundingNeed) * 100) / 100,
    weeksGained,
    // "Evita lo scoperto" ha senso solo se lo scoperto c'era.
    avoidsShortfall:
      base.firstNegativeWeek !== null && modificato.firstNegativeWeek === null,
    movesBeyondHorizon,
    weeks: modificato.weeks,
  };
}

export function computeLevers(
  input: CashFlowInputs,
  base: CashFlowPlan,
  options: LeverOptions = {},
): Lever[] {
  const o = { ...PREDEFINITI, ...options };

  // --- 1. Incassare prima -----------------------------------------------
  // Accorciare la dilazione di N giorni libera una volta sola N giorni di
  // incassi. Non cambia il regime: cambia il momento.
  const incassiGiornalieri = media(input.receipts) / 7;
  const anticipo = buildPlan({
    ...input,
    receipts: spalma(input.receipts, incassiGiornalieri * o.collectDaysEarlier, o.collectDaysEarlier),
  });

  // --- 2. Pagare dopo ----------------------------------------------------
  // Simmetrico: si trattiene N giorni di pagamenti, quindi l'uscita cala.
  const pagamentiGiornalieri = media(input.supplierPayments) / 7;
  const dilazione = buildPlan({
    ...input,
    supplierPayments: spalma(
      input.supplierPayments, -pagamentiGiornalieri * o.payDaysLater, o.payDaysLater,
    ),
  });

  // --- 3. Spostare gli stipendi -----------------------------------------
  // Ogni settimana eredita gli stipendi della precedente; le prime restano
  // scoperte. L'ultimo pagamento finisce oltre l'orizzonte: non e' sparito.
  const k = Math.max(0, Math.min(WEEKS_IN_PLAN, Math.round(o.payrollShiftWeeks)));
  const stipendiSpostati = input.payroll.map((_, i) =>
    i < k ? 0 : input.payroll[i - k]!,
  );
  const spostamento = buildPlan({ ...input, payroll: stipendiSpostati });
  const qualcosaEsce = k > 0 && input.payroll.slice(-k).some((v) => v !== 0);

  return [
    confronta("collect-earlier", "lever.collect_earlier", o.collectDaysEarlier,
      base, anticipo, false),
    confronta("pay-later", "lever.pay_later", o.payDaysLater,
      base, dilazione, false),
    confronta("shift-payroll", "lever.shift_payroll", k,
      base, spostamento, qualcosaEsce),
  ];
}
