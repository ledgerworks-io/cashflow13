/**
 * La colonna email.
 *
 * Stabilisce quello che si può stabilire senza SMTP — e, soprattutto, **dice di
 * non sapere quando non sa**, perché è quel verdetto che rende un record
 * gratuito per il cliente.
 *
 * Perché senza SMTP: la porta 25 in uscita da questa macchina è filtrata da
 * Hetzner (DIARIO §7.6), quindi non si può interrogare `RCPT TO`. Misurato:
 * si aggiudica il 17,5% di una lista B2B e il 63,5% di uno scrape locale
 * (DIARIO §12). Il resto resta indecidibile, per costruzione e non per pigrizia.
 *
 * Il motore di aggiudicazione è sincrono e non tocca la rete. Perciò i domini si
 * risolvono **prima**, in blocco e una volta per dominio, e al motore arriva una
 * tabella già pronta. È lo stesso principio di `audit/report.ts`: il calcolo
 * resta provabile senza rete.
 */

import type { EmailAdjudication } from "./verdict.js";

/** Quello che il DNS dice di un dominio. Nient'altro serve. */
export interface DomainFacts {
  /**
   * `NULL_MX` è il caso RFC 7505: il dominio pubblica `MX 0 .` e dichiara così,
   * per iscritto, di non accettare posta. È diverso da «non ha MX».
   */
  status: "NOERROR" | "NXDOMAIN" | "TIMEOUT" | "ERROR" | "NULL_MX";
  mx: string[];
  /** Un record A senza MX vale come server di posta: RFC 5321 §5.1. */
  hasA: boolean;
}

export type DomainResolver = (domain: string) => Promise<DomainFacts>;

/**
 * Quanti domini si interrogano insieme.
 *
 * Non è una manopola di prestazioni: è una promessa al cliente. Fino al
 * 6 agosto 2026 i domini partivano tutti insieme con `Promise.all`, e misurato
 * quel giorno **3.000 domini in un colpo davano il 12,2% in TIMEOUT**. Un
 * timeout diventa `undecidable`, cioè un record che dichiariamo di non saper
 * giudicare **per colpa nostra** e che quindi non fatturiamo: si perde
 * l'incasso e si consegna un «non lo so» che non era vero, proprio sulle
 * esecuzioni grosse.
 *
 * Cinquanta è il numero che nella stessa misura non produceva nessun timeout.
 */
export const MAX_DNS_IN_PARALLELO = 50;

/**
 * Esegue `lavoro` su ogni elemento, non più di `limite` alla volta.
 *
 * Deliberatamente minuscolo e senza dipendenze: gli operai pescano dalla
 * stessa coda finché non è vuota, così un dominio lento non blocca gli altri.
 */
async function inPool<T>(
  elementi: readonly T[],
  limite: number,
  lavoro: (x: T) => Promise<void>,
): Promise<void> {
  let prossimo = 0;
  const operai = Array.from(
    { length: Math.max(1, Math.min(limite, elementi.length)) },
    async () => {
      for (;;) {
        const i = prossimo++;
        if (i >= elementi.length) return;
        await lavoro(elementi[i]!);
      }
    },
  );
  await Promise.all(operai);
}

/** Il bersaglio di un MX nullo è la radice: `.` oppure, per node, la stringa vuota. */
function bersaglioNullo(exchange: string): boolean {
  return exchange.trim().replace(/\.$/, "") === "";
}

/** Cosa dice la risposta MX, prima di decidere qualunque cosa. */
export type LetturaMx =
  | { kind: "null-mx" }
  | { kind: "servers"; mx: string[] }
  | { kind: "none" };

/**
 * Traduce la risposta MX in fatti.
 *
 * Sta fuori dal risolutore di rete **apposta**: questa traduzione era la sola
 * cucitura del modulo che nessun test sorvegliava, ed è esattamente lì che
 * viveva il difetto del MX nullo (trovato il 6 agosto 2026 rifacendo le
 * misure). Una funzione pura si prova senza rete; un `if` dentro `fetch` no.
 */
export function leggiMx(records: ReadonlyArray<{ exchange: string }>): LetturaMx {
  if (records.length === 0) return { kind: "none" };
  const veri = records.filter((r) => !bersaglioNullo(r.exchange));
  // RFC 7505 vuole il MX nullo da solo. Se convive con server veri la zona è
  // sbagliata: fra dichiarare morto un dominio che ha server e ignorare un
  // record malformato, si sceglie di non fare danno.
  if (veri.length === 0) return { kind: "null-mx" };
  return { kind: "servers", mx: veri.map((r) => r.exchange.trim().toLowerCase()) };
}

/** Domini usa-e-getta. Lista corta e certa: meglio pochi e sicuri che molti e discutibili. */
const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "yopmail.com",
  "trashmail.com", "temp-mail.org", "sharklasers.com", "getnada.com",
  "dispostable.com", "fakeinbox.com", "maildrop.cc", "mohmal.com",
  "throwawaymail.com", "tempmail.com", "mailnesia.com", "spamgourmet.com",
]);

/** Caselle di funzione, non di persona. Non è un difetto: è un'informazione. */
const ROLE = new Set([
  "info", "sales", "support", "admin", "contact", "noreply", "no-reply",
  "webmaster", "postmaster", "hello", "team", "office", "marketing",
  "billing", "help", "abuse", "careers", "jobs", "press", "privacy",
]);

/** Provider di massa, per riconoscere gli errori di battitura che li imitano. */
const POPULAR = [
  "gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com",
  "aol.com", "protonmail.com", "libero.it", "gmx.de", "web.de",
];

// Sintassi pragmatica secondo RFC 5322: niente punto iniziale, finale o doppio,
// niente spazi, una sola chiocciola, parte locale <= 64, dominio con TLD alfabetico.
const LOCAL = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const DOMAIN = /^(?=.{1,253}$)([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

/** Distanza di edit, per riconoscere `gmial.com` senza inseguire una lista infinita. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** Normalizza per il confronto: gli indirizzi arrivano come capita. */
export function normalize(address: string): string {
  return address.trim().toLowerCase();
}

export function domainOf(address: string): string | null {
  const at = normalize(address).lastIndexOf("@");
  return at <= 0 ? null : normalize(address).slice(at + 1);
}

/**
 * Quello che si decide senza chiedere niente a nessuno.
 * `null` significa: serve il DNS, non «va bene».
 */
export function classifyWithoutNetwork(address: string): EmailAdjudication | null {
  const a = normalize(address);
  const at = a.lastIndexOf("@");
  if (at <= 0 || a.indexOf("@") !== at) {
    return { verdict: "undeliverable", reason: "invalid syntax: address must contain exactly one @" };
  }
  const local = a.slice(0, at);
  const domain = a.slice(at + 1);
  if (local.length > 64 || !LOCAL.test(local)) {
    return { verdict: "undeliverable", reason: "invalid syntax: local part is not valid" };
  }
  if (!DOMAIN.test(domain)) {
    return { verdict: "undeliverable", reason: "invalid syntax: domain is not valid" };
  }
  if (DISPOSABLE.has(domain)) {
    return { verdict: "disposable", reason: `${domain} is a throwaway mail service` };
  }
  return null;
}

/** Il giudizio che serve il DNS, dato quello che il DNS ha detto. */
function classifyWithFacts(address: string, facts: DomainFacts): EmailAdjudication {
  const a = normalize(address);
  const at = a.lastIndexOf("@");
  const local = a.slice(0, at);
  const domain = a.slice(at + 1);

  if (facts.status === "NXDOMAIN") {
    return { verdict: "undeliverable", reason: `the domain ${domain} does not exist` };
  }
  // Prima del ripiego sul record A, e non dopo: un MX nullo BATTE il record A.
  // `example.com` ha due record A e un MX nullo — dire che accetta posta
  // significherebbe contraddire quello che il dominio dichiara per iscritto.
  if (facts.status === "NULL_MX") {
    return {
      verdict: "undeliverable",
      reason: `${domain} publishes a null MX record (RFC 7505): it accepts no mail`,
    };
  }
  if (facts.status === "TIMEOUT" || facts.status === "ERROR") {
    return { verdict: "undecidable", reason: "the domain could not be checked" };
  }
  if (facts.mx.length === 0 && !facts.hasA) {
    return { verdict: "undeliverable", reason: `${domain} has no mail server` };
  }

  // Da qui in poi il dominio riceve posta. Della CASELLA non sappiamo nulla.
  const vicino = POPULAR.filter((p) => p !== domain)
    .map((p) => ({ p, d: levenshtein(domain, p) }))
    .filter((x) => x.d <= 2)
    .sort((x, y) => x.d - y.d)[0];
  if (vicino) {
    return { verdict: "suspect", reason: `${domain} looks like a typo of ${vicino.p}` };
  }
  if (ROLE.has(local)) {
    return { verdict: "role", reason: `${local}@ is a role address, not a person` };
  }
  return {
    verdict: "undecidable",
    reason: "the domain accepts mail, but whether this mailbox exists cannot be verified without SMTP",
  };
}

const NON_RISOLTO: EmailAdjudication = {
  verdict: "undecidable",
  reason: "the address was not checked",
};

/**
 * Risolve i domini una volta sola e restituisce la funzione sincrona che il
 * motore si aspetta. Quello che non si è potuto controllare resta indecidibile:
 * non si inventa mai un verdetto, perché un verdetto inventato è un addebito
 * non dovuto.
 */
export async function buildEmailLookup(
  addresses: Iterable<string>,
  resolve: DomainResolver,
): Promise<(address: string) => EmailAdjudication> {
  const statici = new Map<string, EmailAdjudication>();
  const daRisolvere = new Map<string, string[]>(); // dominio -> indirizzi
  // Un insieme, non una scansione di tutte le liste per ogni indirizzo: quella
  // era quadratica e su 40.000 indirizzi costava 8 secondi di solo confronto.
  const visti = new Set<string>();

  for (const raw of addresses) {
    const a = normalize(raw);
    if (a === "" || visti.has(a)) continue;
    visti.add(a);
    const subito = classifyWithoutNetwork(a);
    if (subito) {
      statici.set(a, subito);
      continue;
    }
    const dominio = domainOf(a)!;
    const lista = daRisolvere.get(dominio);
    if (lista) lista.push(a);
    else daRisolvere.set(dominio, [a]);
  }

  const fatti = new Map<string, DomainFacts>();
  // A scaglioni, non tutti insieme: vedi MAX_DNS_IN_PARALLELO.
  await inPool([...daRisolvere.keys()], MAX_DNS_IN_PARALLELO, async (dominio) => {
    try {
      fatti.set(dominio, await resolve(dominio));
    } catch {
      // Un risolutore che esplode non deve far esplodere l'aggiudicazione:
      // diventa «non lo so», che per il cliente significa gratis.
      fatti.set(dominio, { status: "ERROR", mx: [], hasA: false });
    }
  });

  const risolti = new Map<string, EmailAdjudication>();
  for (const [dominio, indirizzi] of daRisolvere) {
    const f = fatti.get(dominio) ?? { status: "ERROR" as const, mx: [], hasA: false };
    for (const a of indirizzi) risolti.set(a, classifyWithFacts(a, f));
  }

  return (address: string) => {
    const a = normalize(address);
    return statici.get(a) ?? risolti.get(a) ?? NON_RISOLTO;
  };
}

/** Il risolutore vero, sopra il DNS di sistema. L'unico punto che tocca la rete. */
export function nodeDnsResolver(timeoutMs = 5_000): DomainResolver {
  return async (domain) => {
    const dns = await import("node:dns/promises");
    const resolver = new dns.Resolver({ timeout: timeoutMs, tries: 2 });
    try {
      const lettura = leggiMx(await resolver.resolveMx(domain));
      // Il MX nullo esce subito: non si guarda il record A, per RFC 7505.
      if (lettura.kind === "null-mx") return { status: "NULL_MX", mx: [], hasA: false };
      if (lettura.kind === "servers") {
        return { status: "NOERROR", mx: lettura.mx, hasA: false };
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOTFOUND" || code === "NXDOMAIN") {
        return { status: "NXDOMAIN", mx: [], hasA: false };
      }
      if (code !== "ENODATA") {
        return { status: "TIMEOUT", mx: [], hasA: false };
      }
    }
    // Nessun MX: si guarda il ripiego RFC 5321 sul record A.
    try {
      const a = await resolver.resolve4(domain);
      return { status: "NOERROR", mx: [], hasA: a.length > 0 };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOTFOUND" || code === "NXDOMAIN") {
        return { status: "NXDOMAIN", mx: [], hasA: false };
      }
      if (code === "ENODATA") return { status: "NOERROR", mx: [], hasA: false };
      return { status: "TIMEOUT", mx: [], hasA: false };
    }
  };
}
