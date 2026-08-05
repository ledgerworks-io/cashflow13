/**
 * Il magazzino temporaneo dei file, dietro un'interfaccia sola.
 *
 * Due realizzazioni, perche' i due ambienti hanno vincoli diversi:
 *
 *  - MEMORIA (il nostro VPS): un processo solo, che resta acceso. La memoria
 *    e' il posto giusto: niente disco, niente da cancellare, niente GDPR.
 *
 *  - ARCHIVIO APIFY (l'attore in Standby): i contenitori vengono spenti dopo
 *    cinque minuti di inattivita' e ne girano piu' d'uno in parallelo quando le
 *    richieste salgono. Un link tenuto in memoria dal contenitore A muore
 *    quando risponde il contenitore B, o quando A si spegne. Non e' un caso
 *    limite: e' il funzionamento normale della piattaforma.
 *
 * L'interfaccia e' la stessa, cambia solo dove finiscono i byte.
 */

export interface StoredBlob {
  data: Buffer;
  filename: string;
}

export interface BlobStore {
  /** Come si chiama questo magazzino, per la diagnostica. */
  readonly kind: string;
  put(data: Buffer, filename: string): Promise<{ key: string; expiresAt: number }>;
  get(key: string): Promise<StoredBlob | null>;
  /** Cancella dopo la consegna: il file ha finito il suo lavoro. */
  drop(key: string): Promise<void>;
}
