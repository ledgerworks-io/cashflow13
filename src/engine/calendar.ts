/**
 * Il calendario delle 13 settimane.
 *
 * Convenzione: le settimane chiudono di VENERDI'. E' la pratica americana, e
 * cade dove cadono stipendi e chiusure bancarie. Parametrica, ma il valore
 * predefinito e' venerdi' e finisce scritto nell'intestazione della cartella
 * Excel: chi riceve il file deve sapere cosa sta guardando senza chiederlo.
 *
 * Tutto in UTC di proposito. Con l'ora locale una settimana a cavallo del
 * cambio d'ora dura 7 giorni e 1 ora, e da li' in poi le date scivolano.
 */

export const WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

/** 5 = venerdì. */
export const DEFAULT_WEEK_ENDS_ON = 5;

export const WEEKS_IN_PLAN = 13;

const GIORNO_MS = 86_400_000;

/**
 * Le 13 date di chiusura, a partire dalla prima >= startDate.
 *
 * Regola sul bordo: se startDate cade GIA' sul giorno di chiusura, quella e'
 * la settimana 1 — non se ne salta una. E' l'errore che sposta tutto il piano
 * di sette giorni senza che nessuno se ne accorga.
 */
export function weekEndings(
  startDate: Date,
  weekEndsOn: number = DEFAULT_WEEK_ENDS_ON,
  count: number = WEEKS_IN_PLAN,
): Date[] {
  if (Number.isNaN(startDate.getTime())) {
    throw new RangeError("startDate non è una data valida");
  }
  if (!Number.isInteger(weekEndsOn) || weekEndsOn < 0 || weekEndsOn > 6) {
    throw new RangeError(`weekEndsOn dev'essere un intero 0-6, ricevuto ${weekEndsOn}`);
  }

  const inizio = Date.UTC(
    startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate(),
  );
  const scarto = (weekEndsOn - new Date(inizio).getUTCDay() + 7) % 7;
  const prima = inizio + scarto * GIORNO_MS;

  return Array.from({ length: count }, (_, i) => new Date(prima + i * 7 * GIORNO_MS));
}

export function weekdayName(weekEndsOn: number = DEFAULT_WEEK_ENDS_ON): Weekday {
  const nome = WEEKDAYS[weekEndsOn];
  if (!nome) throw new RangeError(`weekEndsOn fuori intervallo: ${weekEndsOn}`);
  return nome;
}
