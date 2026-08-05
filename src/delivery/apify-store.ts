import { randomBytes } from "node:crypto";

import type { BlobStore, StoredBlob } from "./blob-store.js";
import { XLSX_MIME } from "../excel/workbook.js";

/**
 * Magazzino appoggiato all'archivio chiave-valore di Apify.
 *
 * Perche' non la memoria, la': i contenitori in Standby si spengono dopo cinque
 * minuti di inattivita' e se ne avviano piu' d'uno quando le richieste salgono.
 * L'archivio invece e' unico e sopravvive ai contenitori, quindi un link
 * funziona a prescindere da chi risponde e da quanti ce ne sono.
 *
 * Il file viene CANCELLATO appena consegnato. Su Apify i byte toccano il disco
 * della piattaforma, che sul nostro server non accade: il minimo che si possa
 * fare e' non lasciarli li' un minuto piu' del necessario.
 */

const API = "https://api.apify.com/v2";

/** Il TTL non lo impone l'archivio: lo controlliamo noi al ritiro. */
const TTL_MS = 60 * 60 * 1000;

interface Meta {
  filename: string;
  expiresAt: number;
}

export class ApifyKeyValueStore implements BlobStore {
  readonly #storeId: string;
  readonly #token: string;

  constructor(storeId: string, token: string) {
    this.#storeId = storeId;
    this.#token = token;
  }

  /** Presente solo quando giriamo dentro un'esecuzione Apify. */
  static fromEnvironment(): ApifyKeyValueStore | null {
    const storeId = process.env.APIFY_DEFAULT_KEY_VALUE_STORE_ID;
    const token = process.env.APIFY_TOKEN;
    if (!storeId || !token) return null;
    return new ApifyKeyValueStore(storeId, token);
  }

  #url(key: string): string {
    return `${API}/key-value-stores/${this.#storeId}/records/${encodeURIComponent(key)}`;
  }

  async put(data: Buffer, filename: string): Promise<{ key: string; expiresAt: number }> {
    const key = randomBytes(24).toString("base64url");
    const expiresAt = Date.now() + TTL_MS;

    const risposta = await fetch(this.#url(key), {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${this.#token}`,
        "Content-Type": XLSX_MIME,
      },
      body: new Uint8Array(data),
    });
    if (!risposta.ok) {
      throw new Error(
        `archivio Apify: scrittura fallita ${risposta.status} ${await risposta.text()}`,
      );
    }

    // I metadati in un record a parte: l'archivio conserva il corpo, non il
    // nome del file ne' la scadenza.
    await fetch(this.#url(`${key}.meta`), {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${this.#token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ filename, expiresAt } satisfies Meta),
    });

    return { key, expiresAt };
  }

  async get(key: string): Promise<StoredBlob | null> {
    const meta = await fetch(this.#url(`${key}.meta`), {
      headers: { Authorization: `Bearer ${this.#token}` },
    });
    if (!meta.ok) return null;
    const { filename, expiresAt } = (await meta.json()) as Meta;
    if (expiresAt <= Date.now()) {
      await this.drop(key);
      return null;
    }

    const corpo = await fetch(this.#url(key), {
      headers: { Authorization: `Bearer ${this.#token}` },
    });
    if (!corpo.ok) return null;

    return { data: Buffer.from(await corpo.arrayBuffer()), filename };
  }

  async drop(key: string): Promise<void> {
    const intestazioni = { Authorization: `Bearer ${this.#token}` };
    await Promise.allSettled([
      fetch(this.#url(key), { method: "DELETE", headers: intestazioni }),
      fetch(this.#url(`${key}.meta`), { method: "DELETE", headers: intestazioni }),
    ]);
  }
}
