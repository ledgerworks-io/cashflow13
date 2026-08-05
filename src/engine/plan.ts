import {
  DEFAULT_WEEK_ENDS_ON,
  WEEKS_IN_PLAN,
  type Weekday,
  weekEndings,
  weekdayName,
} from "./calendar.js";

/**
 * Il motore: sei flussi in, una griglia di 13 settimane fuori, e i due numeri
 * per cui uno apre lo strumento — la settimana in cui la cassa va sotto zero,
 * e quanto serve al punto peggiore.
 *
 * Qui la correttezza E' il prodotto: uno strumento finanziario che sbaglia un
 * numero e' peggio di uno che non esiste.
 */

export interface CashFlowInputs {
  startDate: Date;
  openingBalance: number;
  /** Tredici valori, uno per settimana. */
  receipts: number[];
  supplierPayments: number[];
  payroll: number[];
  loanRepayments: number[];
  taxes: number[];
  weekEndsOn?: number;
}

export interface WeekRow {
  week: number;
  weekEnding: Date;
  opening: number;
  receipts: number;
  supplierPayments: number;
  payroll: number;
  loanRepayments: number;
  taxes: number;
  netMovement: number;
  closing: number;
}

export interface CashFlowPlan {
  weeks: WeekRow[];
  /** Prima settimana con saldo di chiusura sotto zero, o null se non accade. */
  firstNegativeWeek: number | null;
  /** Il saldo (negativo) di quella settimana, o null. */
  shortfallAtFirstNegative: number | null;
  /** Quanto serve al punto peggiore: numero POSITIVO. Zero se non serve nulla. */
  peakFundingNeed: number;
  lowestClosingBalance: number;
  weekEndsOn: Weekday;
}

/**
 * Arrotonda al centesimo.
 *
 * Non e' cosmesi. In virgola mobile 0.1 + 0.2 fa 0.30000000000000004: su 13
 * settimane e sei flussi l'errore si accumula, e un saldo che dovrebbe essere
 * esattamente zero puo' uscire a −1e-13. Lo strumento direbbe "sei sotto zero"
 * mentre non lo sei — ed e' proprio LA risposta che il cliente e' venuto a
 * cercare. Si arrotonda a ogni saldo, non solo alla fine.
 */
function centesimi(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

function serie(nome: string, v: number[]): number[] {
  if (v.length !== WEEKS_IN_PLAN) {
    throw new RangeError(`${nome}: attesi ${WEEKS_IN_PLAN} valori, ricevuti ${v.length}`);
  }
  v.forEach((x, i) => {
    if (!Number.isFinite(x)) {
      throw new RangeError(`${nome}[${i}] non è un numero finito: ${x}`);
    }
  });
  return v;
}

export function buildPlan(input: CashFlowInputs): CashFlowPlan {
  if (!Number.isFinite(input.openingBalance)) {
    throw new RangeError(`openingBalance non è un numero finito: ${input.openingBalance}`);
  }
  const receipts = serie("receipts", input.receipts);
  const supplierPayments = serie("supplierPayments", input.supplierPayments);
  const payroll = serie("payroll", input.payroll);
  const loanRepayments = serie("loanRepayments", input.loanRepayments);
  const taxes = serie("taxes", input.taxes);

  const weekEndsOn = input.weekEndsOn ?? DEFAULT_WEEK_ENDS_ON;
  const chiusure = weekEndings(input.startDate, weekEndsOn);

  const weeks: WeekRow[] = [];
  let saldo = centesimi(input.openingBalance);

  for (let i = 0; i < WEEKS_IN_PLAN; i++) {
    const inc = receipts[i]!;
    const forn = supplierPayments[i]!;
    const stip = payroll[i]!;
    const rate = loanRepayments[i]!;
    const imp = taxes[i]!;

    const netMovement = centesimi(inc - forn - stip - rate - imp);
    const opening = saldo;
    const closing = centesimi(opening + netMovement);

    weeks.push({
      week: i + 1,
      weekEnding: chiusure[i]!,
      opening,
      receipts: inc,
      supplierPayments: forn,
      payroll: stip,
      loanRepayments: rate,
      taxes: imp,
      netMovement,
      closing,
    });

    saldo = closing;
  }

  // Sotto zero significa MINORE di zero. Un saldo di esattamente zero non e'
  // uno scoperto: hai finito i soldi ma non ne devi.
  const prima = weeks.find((w) => w.closing < 0) ?? null;

  const minimo = Math.min(...weeks.map((w) => w.closing));

  return {
    weeks,
    firstNegativeWeek: prima?.week ?? null,
    shortfallAtFirstNegative: prima?.closing ?? null,
    // Il picco cumulato, NON lo scoperto della prima settimana negativa: la
    // cassa puo' risalire e poi sprofondare piu' giu'. Sono due numeri diversi
    // e vengono confusi di continuo.
    peakFundingNeed: minimo < 0 ? centesimi(-minimo) : 0,
    lowestClosingBalance: minimo,
    weekEndsOn: weekdayName(weekEndsOn),
  };
}
