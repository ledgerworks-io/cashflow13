/**
 * Le decisioni che riguardano la piattaforma, tenute PURE apposta.
 *
 * `actor.ts` è escluso dal cancello di copertura perché è un punto d'ingresso:
 * prende l'input, chiama il motore, consegna. Il 6 agosto 2026 la verifica
 * indipendente ha trovato che dentro quell'esclusione si erano infilate due
 * decisioni **commerciali**, dove nessun test le guardava.
 *
 * Stanno qui perché una funzione pura si prova; un `fetch` no.
 */

import { priceFromPricingInfo, type ApifyPricingInfo } from "./billing.js";

/**
 * Il limite di Apify su `POST /v2/datasets/{id}/items`.
 *
 * Misurato il 6 agosto 2026, non dedotto: un corpo da 14,3 MB torna
 * `413 request-too-large` — testuale, «limit: 9437184 bytes» — e `itemCount`
 * resta **0**. Non scrive niente, nemmeno in parte.
 *
 * Perché è una decisione commerciale e non idraulica: `fetch` non lancia sui
 * 4xx. Chi manda tutti i verdetti in un colpo e non guarda `r.ok` scrive nei
 * log «verdetti riga per riga: nel dataset dell'esecuzione», non li consegna,
 * e poi addebita. A ~168 byte per riga la soglia arriva verso i 56.000 record:
 * cioè proprio le esecuzioni grosse, quelle che pagano.
 */
export const MAX_DATASET_POST_BYTES = 9_437_184;

/**
 * Spezza i verdetti in corpi che stanno sotto il limite.
 *
 * Il conto è sul corpo VERO — parentesi quadre e virgole comprese — perché è
 * quello che la piattaforma misura, non la somma degli oggetti.
 */
export function chunkForDataset<T>(
  records: readonly T[],
  maxBytes: number = MAX_DATASET_POST_BYTES,
): T[][] {
  if (records.length === 0) return [];

  const pezzi: T[][] = [];
  let corrente: T[] = [];
  let dimensione = 2; // `[` e `]`

  for (const r of records) {
    // +1 per la virgola che separa questo elemento dal precedente.
    const suo = Buffer.byteLength(JSON.stringify(r), "utf8") + 1;
    if (suo + 2 > maxBytes) {
      // Una riga sola oltre il limite non è divisibile. Spedirla comunque
      // vorrebbe dire un 413 ignorato, cioè il difetto che stiamo chiudendo.
      // La causa quasi sempre è la stessa e conviene nominarla: la regola che
      // il record ha violato viene ricopiata dentro OGNI verdetto di scarto,
      // valore compreso. Un `value` enorme nell'input (una lista `oneOf` lunga,
      // per esempio) gonfia ogni riga di uscita della stessa quantità.
      throw new RangeError(
        `una singola riga di verdetto occupa ${suo} byte e non sta nel limite di `
        + `${maxBytes} imposto da Apify. Di solito significa che un criterio in `
        + `«filters» ha un valore molto grande: viene ripetuto in ogni record che `
        + `lo viola. Accorcia quel criterio e riprova.`,
      );
    }
    if (corrente.length > 0 && dimensione + suo > maxBytes) {
      pezzi.push(corrente);
      corrente = [];
      dimensione = 2;
    }
    corrente.push(r);
    dimensione += suo;
  }
  if (corrente.length > 0) pezzi.push(corrente);
  return pezzi;
}

/**
 * La chiave sotto cui la ricevuta Excel viene consegnata nell'archivio
 * chiave-valore dell'esecuzione.
 *
 * È una costante e non un letterale sparso perché **lo schema di uscita la
 * pubblica**: `.actor/output_schema.json` dice al cliente di andare a prenderla
 * lì. Se il codice la scrivesse altrove, la scheda indicherebbe un file che non
 * esiste — un `404` al posto del documento che dimostra la fattura. C'è un test
 * che confronta le due cose.
 */
export const RECEIPT_KEY = "OUTPUT.xlsx";

/** Da dove è stato letto il prezzo. Serve a dirlo nei log, non a decidere. */
export type PriceSource = "run" | "actor" | "none";

/**
 * Il prezzo davvero applicato a QUESTA esecuzione.
 *
 * Prima la corsa, poi l'attore, e il perché conta più dell'ordine:
 *
 *  - `GET /v2/actor-runs/{runId}` → `pricingInfo` è il prezzo **risolto per la
 *    fascia di chi chiama**: Apify appiattisce `eventTieredPricingUsd` nel
 *    singolo `eventPriceUsd` valido per quella corsa. È il numero che il
 *    cliente paga davvero, quindi è quello che la ricevuta deve dichiarare.
 *  - `GET /v2/acts/{id}` → `currentPricingInfo` è il ripiego, e sulla fascia
 *    FREE, che è la più alta. Ma su un attore **privato resta `null`**
 *    (misurato il 6 agosto 2026, anche dopo aver scritto `pricingInfos`):
 *    leggere solo lì significa non leggere mai niente prima della
 *    pubblicazione, cioè accendere la difesa contro il bait-and-switch per la
 *    prima volta in produzione.
 *
 * `null` se non si riesce a leggere: meglio non sapere che credere a un numero
 * sbagliato.
 */
export function priceFromRunOrActor(
  runPricingInfo: ApifyPricingInfo | null | undefined,
  actorPricingInfo: ApifyPricingInfo | null | undefined,
  eventName: string,
): { priceUsd: number | null; source: PriceSource } {
  const dallaCorsa = priceFromPricingInfo(runPricingInfo, eventName);
  if (dallaCorsa !== null) return { priceUsd: dallaCorsa, source: "run" };

  const dallAttore = priceFromPricingInfo(actorPricingInfo, eventName);
  if (dallAttore !== null) return { priceUsd: dallAttore, source: "actor" };

  return { priceUsd: null, source: "none" };
}
