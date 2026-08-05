import { WEEKS_IN_PLAN } from "./calendar.js";

/**
 * Da fatturato + DSO agli incassi settimanali. Da acquisti + DPO ai pagamenti
 * a fornitore. La matematica e' la stessa: un flusso economico e un ritardo.
 *
 * LA REGOLA, e perche'.
 *
 * L'implementazione ingenua mette zero incassi per le prime DSO/7 settimane —
 * "quelle vendite non sono ancora incassate" — e fa risultare in default
 * chiunque. E' sbagliata, e si vede al primo sguardo.
 *
 * Quello che succede davvero e' che il portafoglio crediti gia' aperto si
 * smonta mentre si fanno vendite nuove. In STATO STAZIONARIO le due cose si
 * compensano esattamente: si incassa a settimana quanto si fattura, e il DSO
 * non muove il piano base. Il DSO conta nelle LEVE — accorciarlo di 15 giorni
 * libera una volta sola circa (fatturato giornaliero x 15).
 *
 * Se pero' si conosce il saldo crediti iniziale, si puo' fare di meglio: la
 * differenza fra il portafoglio reale e quello che lo stato stazionario si
 * aspetterebbe e' una tantum, e si smonta lungo la finestra del DSO. Serve a
 * chi non e' in regime: cresce in fretta, o ha appena incassato una commessa.
 */

export interface FlowFromDriver {
  /** Fatturato (o acquisti) per settimana: 13 valori. */
  perWeek: number[];
  /** Giorni di dilazione: DSO per gli incassi, DPO per i pagamenti. */
  days: number;
  /** Facoltativo: crediti (o debiti) aperti all'inizio del piano. */
  openingBalance?: number;
}

const GIORNI_SETTIMANA = 7;

export function deriveFlow(input: FlowFromDriver): number[] {
  const { perWeek, days, openingBalance } = input;

  if (perWeek.length !== WEEKS_IN_PLAN) {
    throw new RangeError(
      `perWeek: attesi ${WEEKS_IN_PLAN} valori, ricevuti ${perWeek.length}`,
    );
  }
  perWeek.forEach((v, i) => {
    if (!Number.isFinite(v)) throw new RangeError(`perWeek[${i}] non è finito: ${v}`);
  });
  if (!Number.isFinite(days) || days < 0) {
    throw new RangeError(`days dev'essere >= 0, ricevuto ${days}`);
  }

  // Stato stazionario: si incassa quello che si fattura.
  const flusso = [...perWeek];

  if (openingBalance === undefined) return flusso;
  if (!Number.isFinite(openingBalance)) {
    throw new RangeError(`openingBalance non è finito: ${openingBalance}`);
  }

  // Quanto il regime si aspetterebbe di trovare aperto, dato il ritmo attuale.
  const medioSettimanale =
    perWeek.reduce((a, b) => a + b, 0) / WEEKS_IN_PLAN;
  const attesoInRegime = (medioSettimanale / GIORNI_SETTIMANA) * days;

  // Lo scarto e' una tantum: si smonta lungo la finestra della dilazione.
  const scarto = openingBalance - attesoInRegime;
  if (scarto === 0) return flusso;

  // La transizione dura quanto la dilazione, ma non oltre l'orizzonte del
  // piano: se il DSO e' 180 giorni, lo scarto si spalma su tutte e 13.
  const settimaneTransizione = Math.min(
    WEEKS_IN_PLAN,
    Math.max(1, Math.ceil(days / GIORNI_SETTIMANA)),
  );
  const quota = scarto / settimaneTransizione;

  for (let i = 0; i < settimaneTransizione; i++) {
    flusso[i] = flusso[i]! + quota;
  }
  return flusso;
}
