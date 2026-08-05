import { randomBytes } from "node:crypto";

import { ApifyKeyValueStore } from "./apify-store.js";
import type { BlobStore, StoredBlob } from "./blob-store.js";

/**
 * Deposito temporaneo dei file da scaricare.
 *
 * Perché esiste: il 2026-08-05 abbiamo provato a consegnare la cartella Excel
 * dentro il protocollo MCP, in due modi. Entrambi rifiutati dal client:
 *   - risorsa incorporata (blob base64)
 *       → "Resources of type '...spreadsheetml.sheet' are not currently supported"
 *   - collegamento a risorsa MCP
 *       → "Resource links are not currently supported"
 * Il secondo errore non nomina il tipo di file: è la CATEGORIA dei collegamenti
 * a risorsa a essere chiusa, non l'xlsx. Sono due porte diverse.
 * Quello che passa è un URL normale: per il protocollo è testo come un altro, e
 * lo scaricamento esce dal perimetro MCP diventando una richiesta HTTPS.
 * Entrambi i limiti sono dichiarati "not currently supported": vale la pena
 * riprovare fra qualche mese.
 *
 * NON è un archivio. Tiene in memoria — mai su disco — numeri che l'utente ha
 * appena digitato, per il tempo di scaricarli, e li dimentica. Il vincolo
 * "niente archivio" nasce per non accumulare i dati finanziari dei clienti.
 */

export interface OpzioniDeposito {
  /** Quanto vive un link. Comodità vuole finestre lunghe, riservatezza corte:
   *  il file sta dietro un URL pubblico non autenticato. */
  ttlMs?: number;
  maxEntries?: number;
  maxTotalBytes?: number;
  /** Iniettabile per i test. */
  now?: () => number;
}

interface Voce {
  data: Buffer;
  filename: string;
  expiresAt: number;
}

export const TTL_PREDEFINITO_MS = 60 * 60 * 1000; // 60 minuti

export class DownloadStore implements BlobStore {
  readonly kind = "memory";
  readonly #ttlMs: number;
  readonly #maxEntries: number;
  readonly #maxTotalBytes: number;
  readonly #now: () => number;
  // Map conserva l'ordine di inserimento: la prima voce è la più vecchia.
  readonly #voci = new Map<string, Voce>();
  #bytes = 0;

  constructor(o: OpzioniDeposito = {}) {
    this.#ttlMs = o.ttlMs ?? TTL_PREDEFINITO_MS;
    this.#maxEntries = o.maxEntries ?? 500;
    this.#maxTotalBytes = o.maxTotalBytes ?? 128 * 1024 * 1024;
    this.#now = o.now ?? Date.now;
  }

  async put(data: Buffer, filename: string): Promise<{ key: string; expiresAt: number }> {
    if (data.length > this.#maxTotalBytes) {
      // Meglio un errore chiaro che svuotare il deposito per far posto a un
      // file che comunque non ci sta.
      throw new Error(
        `file troppo grande: ${data.length} byte, tetto ${this.#maxTotalBytes}`,
      );
    }
    this.#sfrattaScadute();
    while (
      this.#voci.size >= this.#maxEntries ||
      this.#bytes + data.length > this.#maxTotalBytes
    ) {
      if (!this.#sfrattaLaPiuVecchia()) break;
    }

    // 24 byte = 192 bit: non si indovina. Ma resta un URL pubblico, quindi il
    // TTL è la vera protezione, non la lunghezza della chiave.
    const key = randomBytes(24).toString("base64url");
    const expiresAt = this.#now() + this.#ttlMs;
    this.#voci.set(key, { data, filename, expiresAt });
    this.#bytes += data.length;
    return { key, expiresAt };
  }

  /** Il file, se il link è ancora vivo. Scaricabile più volte: il monouso
   *  verrebbe bruciato da un prefetch del browser o da un antivirus. */
  async get(key: string): Promise<StoredBlob | null> {
    const v = this.#voci.get(key);
    if (!v) return null;
    if (v.expiresAt <= this.#now()) {
      this.#rimuovi(key);
      return null;
    }
    return { data: v.data, filename: v.filename };
  }

  async drop(key: string): Promise<void> {
    this.#rimuovi(key);
  }

  size(): number {
    return this.#voci.size;
  }

  totalBytes(): number {
    return this.#bytes;
  }

  #rimuovi(key: string): void {
    const v = this.#voci.get(key);
    if (!v) return;
    this.#bytes -= v.data.length;
    this.#voci.delete(key);
  }

  #sfrattaScadute(): void {
    const ora = this.#now();
    for (const [k, v] of this.#voci) if (v.expiresAt <= ora) this.#rimuovi(k);
  }

  #sfrattaLaPiuVecchia(): boolean {
    const primo = this.#voci.keys().next();
    if (primo.done) return false;
    this.#rimuovi(primo.value);
    return true;
  }
}

/**
 * Il deposito del processo.
 *
 * Su Apify si appoggia all'archivio chiave-valore, perche' li' i contenitori si
 * spengono e si moltiplicano e la memoria non e' condivisa. Altrove resta in
 * memoria, che e' piu' semplice e non tocca nessun disco.
 */
export const deposito: BlobStore =
  ApifyKeyValueStore.fromEnvironment() ?? new DownloadStore();
