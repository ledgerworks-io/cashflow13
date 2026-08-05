import { WEEKS_IN_PLAN } from "./calendar.js";
import type { CashFlowInputs } from "./plan.js";
import { deriveFlow } from "./working-capital.js";

/**
 * Da quello che l'utente ha detto a quello che il motore sa calcolare.
 *
 * Due comodita' che cambiano l'esperienza:
 *  - ogni flusso accetta UN numero (uguale tutte le settimane) oppure TREDICI.
 *    Chi vuole rispondere in fretta da' un numero; chi ha il dettaglio lo mette.
 *  - gli incassi si possono dare diretti, oppure come fatturato + DSO. Idem i
 *    fornitori: pagamenti diretti, o acquisti + DPO.
 *
 * Quando manca qualcosa non si fallisce e basta: si dice COSA manca. L'assistente
 * fa le domande una alla volta, e per farlo deve sapere cosa chiedere ancora.
 */

export type FlowInput = number | number[];

export interface ToolInput {
  startDate?: string | undefined;
  openingBalance?: number | undefined;
  receipts?: FlowInput | undefined;
  revenue?: FlowInput | undefined;
  dsoDays?: number | undefined;
  openingReceivables?: number | undefined;
  supplierPayments?: FlowInput | undefined;
  purchases?: FlowInput | undefined;
  dpoDays?: number | undefined;
  openingPayables?: number | undefined;
  payroll?: FlowInput | undefined;
  loanRepayments?: FlowInput | undefined;
  taxes?: FlowInput | undefined;
  weekEndsOn?: number | undefined;
}

export class MissingInputsError extends Error {
  readonly missing: string[];
  constructor(missing: string[]) {
    super(`dati mancanti: ${missing.join(", ")}`);
    this.name = "MissingInputsError";
    this.missing = missing;
  }
}

/** Uno scalare vale per tutte le settimane; una serie dev'essere di 13. */
function espandi(nome: string, v: FlowInput): number[] {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new RangeError(`${nome} non è un numero finito`);
    return Array.from({ length: WEEKS_IN_PLAN }, () => v);
  }
  if (v.length !== WEEKS_IN_PLAN) {
    throw new RangeError(
      `${nome}: servono 1 valore o ${WEEKS_IN_PLAN}, ricevuti ${v.length}`,
    );
  }
  v.forEach((x, i) => {
    if (!Number.isFinite(x)) throw new RangeError(`${nome}[${i}] non è un numero finito`);
  });
  return [...v];
}

const zeri = (): number[] => Array.from({ length: WEEKS_IN_PLAN }, () => 0);

function facoltativo(nome: string, v: FlowInput | undefined): number[] {
  return v === undefined ? zeri() : espandi(nome, v);
}

function dataDiPartenza(iso: string | undefined): Date {
  if (iso === undefined) {
    const o = new Date();
    return new Date(Date.UTC(o.getUTCFullYear(), o.getUTCMonth(), o.getUTCDate()));
  }
  // Il costruttore Date accetta "2026-02-31" e lo fa scivolare al 3 marzo:
  // una data inventata diventerebbe un piano sbagliato senza avvisare nessuno.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) throw new RangeError(`startDate dev'essere nel formato AAAA-MM-GG: "${iso}"`);
  const [a, me, g] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(a, me - 1, g));
  if (d.getUTCFullYear() !== a || d.getUTCMonth() !== me - 1 || d.getUTCDate() !== g) {
    throw new RangeError(`startDate non è una data esistente: "${iso}"`);
  }
  return d;
}

/**
 * Risolve un flusso che puo' arrivare per via diretta o per via indiretta
 * (fatturato + DSO, acquisti + DPO). La via diretta ha la precedenza.
 */
function flussoDaDriver(
  diretto: FlowInput | undefined,
  nomeDiretto: string,
  driver: FlowInput | undefined,
  nomeDriver: string,
  giorni: number | undefined,
  nomeGiorni: string,
  saldoIniziale: number | undefined,
  mancanti: string[],
): number[] | null {
  if (diretto !== undefined) return espandi(nomeDiretto, diretto);

  if (driver !== undefined) {
    if (giorni === undefined) {
      mancanti.push(nomeGiorni);
      return null;
    }
    return deriveFlow({
      perWeek: espandi(nomeDriver, driver),
      days: giorni,
      ...(saldoIniziale !== undefined ? { openingBalance: saldoIniziale } : {}),
    });
  }

  mancanti.push(nomeDiretto);
  return null;
}

export function normalizeInputs(input: ToolInput): CashFlowInputs {
  const mancanti: string[] = [];

  // Zero e' un saldo legittimo: si controlla l'assenza, non la falsita'.
  if (input.openingBalance === undefined) mancanti.push("openingBalance");

  const receipts = flussoDaDriver(
    input.receipts, "receipts",
    input.revenue, "revenue",
    input.dsoDays, "dsoDays",
    input.openingReceivables, mancanti,
  );

  const supplierPayments = flussoDaDriver(
    input.supplierPayments, "supplierPayments",
    input.purchases, "purchases",
    input.dpoDays, "dpoDays",
    input.openingPayables, mancanti,
  );

  if (mancanti.length > 0) throw new MissingInputsError(mancanti);

  return {
    startDate: dataDiPartenza(input.startDate),
    openingBalance: input.openingBalance!,
    receipts: receipts!,
    supplierPayments: supplierPayments!,
    payroll: facoltativo("payroll", input.payroll),
    loanRepayments: facoltativo("loanRepayments", input.loanRepayments),
    taxes: facoltativo("taxes", input.taxes),
    ...(input.weekEndsOn !== undefined ? { weekEndsOn: input.weekEndsOn } : {}),
  };
}
