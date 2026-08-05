/**
 * Come arriva il file all'utente. Due modi, stessa interfaccia.
 *
 *  - REMOTO (server su mcp.chiriba.it): un URL temporaneo. Non per scelta ma
 *    per necessita': il client rifiuta i binari dentro il protocollo, sia come
 *    risorsa incorporata sia come collegamento a risorsa. Vedi store.ts.
 *
 *  - LOCALE (estensione desktop, stdio): si scrive su disco e si da' il
 *    percorso. Non serve nessun aggiramento, perche' il server gira sulla
 *    macchina dell'utente — e i suoi numeri non la lasciano mai.
 *
 * Iniettata invece che decisa da una variabile globale: il modo di consegnare
 * e' una proprieta' di come il server e' stato avviato, non uno stato sparso.
 */

export interface Delivery {
  kind: "url" | "file";
  /** URL da aprire, oppure percorso assoluto sul disco. */
  location: string;
  expiresAt?: string;
}

export type Deliverer = (data: Buffer, filename: string) => Promise<Delivery>;
