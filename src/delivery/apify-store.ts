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

/**
 * TTL piu' corto che sul nostro server (60 min).
 *
 * Li' il file sta in memoria e non tocca nessun disco; qui sta sul disco di un
 * terzo, in un'altra giurisdizione. La finestra e' il solo parametro che
 * controlliamo davvero, e 20 minuti bastano a chi clicca il link che ha appena
 * ricevuto — che e' quello che succede in pratica.
 */
const TTL_MS = 20 * 60 * 1000;

interface Meta {
  filename: string;
  expiresAt: number;
}

/**
 * NOME dell'archivio. Deve essere un archivio CON NOME, non quello predefinito
 * dell'esecuzione: quello e' nuovo e vuoto a ogni riavvio del contenitore, ed e'
 * quindi effimero quanto la memoria. Verificato il 2026-08-05 con una prova che
 * ha restituito 410 dopo il riciclo.
 */
const NOME_ARCHIVIO = "cashflow13-downloads";

export class ApifyKeyValueStore implements BlobStore {
  readonly kind = "apify-kv";
  readonly #token: string;
  #storeId: string | null = null;

  constructor(token: string, storeId?: string) {
    this.#token = token;
    this.#storeId = storeId ?? null;
  }

  /** Presente solo quando giriamo dentro un'esecuzione Apify. */
  static fromEnvironment(): ApifyKeyValueStore | null {
    // Discriminante: APIFY_TOKEN esiste solo dentro un'esecuzione Apify. Le
    // variabili APIFY_IS_AT_HOME / ACTOR_RUN_ID non sono garantite in Standby,
    // e affidarcisi faceva ricadere tutto in memoria senza dirlo a nessuno.
    const token = process.env.APIFY_TOKEN;
    if (!token) return null;
    return new ApifyKeyValueStore(token);
  }

  /** Apre l'archivio con quel nome, creandolo la prima volta. */
  async #id(): Promise<string> {
    if (this.#storeId) return this.#storeId;
    const r = await fetch(
      `${API}/key-value-stores?name=${encodeURIComponent(NOME_ARCHIVIO)}`,
      { method: "POST", headers: { Authorization: `Bearer ${this.#token}` } },
    );
    if (!r.ok) {
      throw new Error(`archivio Apify: apertura fallita ${r.status} ${await r.text()}`);
    }
    const { data } = (await r.json()) as { data: { id: string } };
    this.#storeId = data.id;
    return data.id;
  }

  async #url(key: string): Promise<string> {
    return `${API}/key-value-stores/${await this.#id()}/records/${encodeURIComponent(key)}`;
  }

  /**
   * Cancella i record scaduti.
   *
   * Serve perche' l'archivio con nome e' PERSISTENTE: il TTL lo verifichiamo al
   * ritiro, ma un link che nessuno apre non passa mai di li' e resterebbe sul
   * disco della piattaforma per sempre. E' il caso opposto a quello coperto
   * dalla scadenza, e va chiuso a mano.
   */
  async #spazzata(): Promise<void> {
    try {
      const r = await fetch(`${API}/key-value-stores/${await this.#id()}/keys?limit=1000`, {
        headers: { Authorization: `Bearer ${this.#token}` },
      });
      if (!r.ok) return;
      const { data } = (await r.json()) as { data: { items: Array<{ key: string }> } };
      const ora = Date.now();

      for (const { key } of data.items) {
        if (!key.endsWith(".meta")) continue;
        const m = await fetch(await this.#url(key), {
          headers: { Authorization: `Bearer ${this.#token}` },
        });
        if (!m.ok) continue;
        const { expiresAt } = (await m.json()) as Meta;
        if (expiresAt <= ora) await this.drop(key.slice(0, -".meta".length));
      }
    } catch {
      // La pulizia non deve mai far fallire la generazione di un piano.
    }
  }

  async put(data: Buffer, filename: string): Promise<{ key: string; expiresAt: number }> {
    // Si passa la scopa a ogni deposito: il volume e' basso e cosi' non serve
    // ne' un processo a parte ne' un timer che nessuno sorveglia.
    void this.#spazzata();

    const key = randomBytes(24).toString("base64url");
    const expiresAt = Date.now() + TTL_MS;

    const risposta = await fetch(await this.#url(key), {
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
    await fetch(await this.#url(`${key}.meta`), {
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
    const meta = await fetch(await this.#url(`${key}.meta`), {
      headers: { Authorization: `Bearer ${this.#token}` },
    });
    if (!meta.ok) return null;
    const { filename, expiresAt } = (await meta.json()) as Meta;
    if (expiresAt <= Date.now()) {
      await this.drop(key);
      return null;
    }

    const corpo = await fetch(await this.#url(key), {
      headers: { Authorization: `Bearer ${this.#token}` },
    });
    if (!corpo.ok) return null;

    return { data: Buffer.from(await corpo.arrayBuffer()), filename };
  }

  async drop(key: string): Promise<void> {
    const intestazioni = { Authorization: `Bearer ${this.#token}` };
    await Promise.allSettled([
      fetch(await this.#url(key), { method: "DELETE", headers: intestazioni }),
      fetch(await this.#url(`${key}.meta`), { method: "DELETE", headers: intestazioni }),
    ]);
  }
}
