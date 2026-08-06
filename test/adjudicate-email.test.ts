import { describe, expect, it } from "vitest";

import {
  MAX_DNS_IN_PARALLELO,
  buildEmailLookup,
  classifyWithoutNetwork,
  leggiMx,
  type DomainFacts,
  type DomainResolver,
} from "../src/adjudicate/email.js";

/**
 * La colonna email.
 *
 * Non può stabilire se una casella esiste: quello richiede la porta 25, che
 * Hetzner tiene chiusa in uscita (DIARIO §7.6). Può stabilire tutto il resto —
 * e la cosa importante è che **dica di non sapere quando non sa**, perché è
 * quel verdetto che rende un record gratuito.
 *
 * Le percentuali di copertura misurate dallo spike (DIARIO §12) sono fissate
 * nel test della garanzia; qui si prova il comportamento caso per caso.
 *
 * Nessun test qui tocca la rete: il risolutore è iniettato.
 */

const VIVO: DomainFacts = { status: "NOERROR", mx: ["mx.azienda.com"], hasA: true };
const SENZA_POSTA: DomainFacts = { status: "NOERROR", mx: [], hasA: false };
const SOLO_A: DomainFacts = { status: "NOERROR", mx: [], hasA: true };
const INESISTENTE: DomainFacts = { status: "NXDOMAIN", mx: [], hasA: false };
const IRRAGGIUNGIBILE: DomainFacts = { status: "TIMEOUT", mx: [], hasA: false };
/** `MX 0 .` — il dominio dichiara di non accettare posta. RFC 7505. */
const MX_NULLO: DomainFacts = { status: "NULL_MX", mx: [], hasA: false };

function risolutore(mappa: Record<string, DomainFacts>, contatore?: { n: number }): DomainResolver {
  return async (dominio) => {
    if (contatore) contatore.n += 1;
    return mappa[dominio] ?? VIVO;
  };
}

async function giudica(
  indirizzi: string[],
  mappa: Record<string, DomainFacts> = {},
  contatore?: { n: number },
) {
  const lookup = await buildEmailLookup(indirizzi, risolutore(mappa, contatore));
  return lookup;
}

describe("quello che si decide senza chiedere niente a nessuno", () => {
  it("una sintassi rotta è morta, e non serve la rete per saperlo", () => {
    for (const brutto of ["senza-chiocciola", "@senza-locale.com", "due@@chiocciole.com",
      "spazio dentro@x.com", "punto..doppio@x.com", ".iniziale@x.com", "finale.@x.com"]) {
      const v = classifyWithoutNetwork(brutto);
      expect(v?.verdict, brutto).toBe("undeliverable");
    }
  });

  it("un dominio usa-e-getta è certo, e non serve la rete", () => {
    expect(classifyWithoutNetwork("tizio@mailinator.com")?.verdict).toBe("disposable");
  });

  it("su un indirizzo normale non si pronuncia: serve il DNS", () => {
    expect(classifyWithoutNetwork("mario@azienda.com")).toBeNull();
  });
});

describe("quello che decide il DNS", () => {
  it("dominio inesistente: morto, con certezza", async () => {
    const l = await giudica(["x@niente.com"], { "niente.com": INESISTENTE });
    expect(l("x@niente.com").verdict).toBe("undeliverable");
  });

  it("dominio senza MX e senza A: morto, con certezza", async () => {
    const l = await giudica(["x@vuoto.com"], { "vuoto.com": SENZA_POSTA });
    expect(l("x@vuoto.com").verdict).toBe("undeliverable");
  });

  it("dominio con A ma senza MX NON è morto: la regola di ripiego RFC 5321", async () => {
    // Il caso vero sono `www.google.com` e `news.ycombinator.com`: record A e
    // NESSUN record MX. Chi "aggiusta" il codice perché fallisca sta rompendo
    // una regola del protocollo.
    //
    // ATTENZIONE: `example.com` NON sta qui — pubblica un MX nullo, che è il
    // caso opposto. Vedi il gruppo di prove qui sotto.
    const l = await giudica(["x@solo-a.com"], { "solo-a.com": SOLO_A });
    expect(l("x@solo-a.com").verdict).toBe("undecidable");
  });

  it("DNS irraggiungibile: indecidibile, quindi gratuito — mai un verdetto inventato", async () => {
    const l = await giudica(["x@boh.com"], { "boh.com": IRRAGGIUNGIBILE });
    expect(l("x@boh.com").verdict).toBe("undecidable");
  });
});

/**
 * Il MX nullo — `MX 0 .` — non è un MX: è la dichiarazione esplicita, per
 * RFC 7505, che il dominio **non accetta posta**.
 *
 * Sta qui perché era un difetto vero, trovato il 6 agosto 2026 rifacendo le
 * misure: `example.com` e `chiriba.it` pubblicano entrambi un MX nullo, e il
 * codice li dichiarava «the domain accepts mail». Erano casi DECIDIBILI
 * dichiarati indecidibili — cioè lo strumento rinunciava a fare il suo mestiere
 * proprio dove poteva farlo con certezza.
 *
 * `leggiMx` è una funzione pura apposta: la traduzione da risposta DNS a fatti
 * era la cucitura non sorvegliata da nessun test, ed è esattamente lì che il
 * difetto viveva.
 */
describe("il MX nullo: RFC 7505", () => {
  it("un MX nullo è un dominio morto, con certezza — quindi si addebita", async () => {
    const l = await giudica(["x@niente-posta.com"], { "niente-posta.com": MX_NULLO });
    expect(l("x@niente-posta.com").verdict).toBe("undeliverable");
  });

  it("il MX nullo BATTE il ripiego sul record A: con A e MX nullo resta morto", async () => {
    // È il caso di `example.com`: ha due record A e un MX nullo. Se il ripiego
    // RFC 5321 vincesse, diremmo «accetta posta» di un dominio che dichiara
    // per iscritto il contrario.
    const conA: DomainFacts = { status: "NULL_MX", mx: [], hasA: true };
    const l = await giudica(["x@example-like.com"], { "example-like.com": conA });
    expect(l("x@example-like.com").verdict).toBe("undeliverable");
  });

  it("la ragione dice al cliente perché, e nomina la regola", async () => {
    const l = await giudica(["x@niente-posta.com"], { "niente-posta.com": MX_NULLO });
    const v = l("x@niente-posta.com");
    expect(v).toHaveProperty("reason");
    expect("reason" in v ? v.reason : "").toMatch(/null MX/i);
  });

  describe("leggiMx — la cucitura fra risposta DNS e fatti", () => {
    it("nessun record: non decide, si passa al ripiego sul record A", () => {
      expect(leggiMx([])).toEqual({ kind: "none" });
    });

    it("bersaglio vuoto: è un MX nullo", () => {
      expect(leggiMx([{ exchange: "" }])).toEqual({ kind: "null-mx" });
    });

    it("bersaglio radice, con e senza punto finale: è un MX nullo", () => {
      // node restituisce "", dig mostra "."; entrambi sono la radice.
      expect(leggiMx([{ exchange: "." }])).toEqual({ kind: "null-mx" });
      expect(leggiMx([{ exchange: " . " }])).toEqual({ kind: "null-mx" });
    });

    it("server veri: si usano, normalizzati", () => {
      expect(leggiMx([{ exchange: "MX1.Azienda.com" }, { exchange: "mx2.azienda.com" }]))
        .toEqual({ kind: "servers", mx: ["mx1.azienda.com", "mx2.azienda.com"] });
    });

    it("misto malformato: il bersaglio nullo si scarta, i server veri vincono", () => {
      // RFC 7505: il MX nullo dev'essere l'unico record. Se non lo è, la zona è
      // sbagliata — e fra dichiarare morto un dominio che ha server veri e
      // ignorare un record malformato, si sceglie di non fare danno.
      expect(leggiMx([{ exchange: "." }, { exchange: "mx.azienda.com" }]))
        .toEqual({ kind: "servers", mx: ["mx.azienda.com"] });
    });
  });
});

describe("quello che si segnala senza scartare", () => {
  it("un indirizzo di ruolo è un verdetto certo, non uno scarto", async () => {
    const l = await giudica(["info@azienda.com"]);
    expect(l("info@azienda.com").verdict).toBe("role");
  });

  it("un errore di battitura di un provider noto è sospetto", async () => {
    const l = await giudica(["mario@gmial.com", "mario@hotmial.com"]);
    expect(l("mario@gmial.com").verdict).toBe("suspect");
    expect(l("mario@hotmial.com").verdict).toBe("suspect");
  });

  it("un dominio davvero diverso non viene scambiato per un errore di battitura", async () => {
    const l = await giudica(["mario@gmail.com", "mario@azienda-seria.com"]);
    expect(l("mario@gmail.com").verdict).toBe("undecidable");
    expect(l("mario@azienda-seria.com").verdict).toBe("undecidable");
  });
});

describe("il caso che decide il prezzo", () => {
  it("indirizzo personale a dominio vero: NON lo sappiamo, e lo diciamo", async () => {
    // È il 70% di una lista B2B. Se un giorno questo test dicesse "deliverable"
    // staremmo fatturando record che non abbiamo aggiudicato.
    const l = await giudica(["mario.rossi@azienda.com"]);
    const v = l("mario.rossi@azienda.com");
    expect(v.verdict).toBe("undecidable");
    expect(v).toHaveProperty("reason");
  });

  it("un provider di massa è indecidibile quanto un dominio aziendale", async () => {
    const l = await giudica(["tizio@gmail.com"]);
    expect(l("tizio@gmail.com").verdict).toBe("undecidable");
  });
});

describe("costo e robustezza", () => {
  it("interroga ogni dominio UNA volta sola, non una per indirizzo", async () => {
    const c = { n: 0 };
    await giudica(
      ["a@azienda.com", "b@azienda.com", "c@azienda.com", "d@altra.com"],
      {},
      c,
    );
    expect(c.n).toBe(2);
  });

  it("non interroga il DNS per quello che è già deciso senza rete", async () => {
    const c = { n: 0 };
    await giudica(["rotta", "x@mailinator.com"], {}, c);
    expect(c.n).toBe(0);
  });

  it("un risolutore che esplode non fa esplodere l'aggiudicazione", async () => {
    const lookup = await buildEmailLookup(["x@boom.com"], async () => {
      throw new Error("rete a pezzi");
    });
    expect(lookup("x@boom.com").verdict).toBe("undecidable");
  });

  it("un indirizzo mai risolto è indecidibile, non un errore", async () => {
    const l = await giudica(["noto@azienda.com"]);
    expect(l("mai-visto@altrove.com").verdict).toBe("undecidable");
  });

  it("il confronto non è sensibile a maiuscole e spazi", async () => {
    const l = await giudica(["  Mario@Azienda.COM  "]);
    expect(l("mario@azienda.com").verdict).toBe("undecidable");
    expect(l("  MARIO@AZIENDA.com ").verdict).toBe("undecidable");
  });

  it("una lista vuota non fa esplodere niente", async () => {
    const l = await buildEmailLookup([], async () => VIVO);
    expect(l("qualsiasi@cosa.com").verdict).toBe("undecidable");
  });
});

/**
 * La raffica di DNS — un difetto che costava soldi, non prestazioni.
 *
 * Fino al 6 agosto 2026 i domini partivano tutti insieme con `Promise.all`.
 * Misurato quel giorno: **3.000 domini in un colpo, il 12,2% in TIMEOUT**.
 * Un timeout diventa `undecidable`, cioè un record che dichiariamo di non
 * saper giudicare **per colpa nostra** e che quindi non fatturiamo. Più grossa
 * la lista, più «non lo so» in faccia al cliente e più incasso perso — e
 * proprio sulle esecuzioni grosse, che sono quelle che pagano.
 */
describe("la raffica di DNS non si spara tutta insieme", () => {
  /** Risolutore che registra quante richieste sono in volo nello stesso momento. */
  function conContatore(): { r: DomainResolver; picco: () => number } {
    let inVolo = 0;
    let picco = 0;
    const r: DomainResolver = async () => {
      inVolo += 1;
      picco = Math.max(picco, inVolo);
      await new Promise((ok) => setTimeout(ok, 1));
      inVolo -= 1;
      return VIVO;
    };
    return { r, picco: () => picco };
  }

  it("il tetto è 50: il numero che nella misura non produceva timeout", () => {
    // Scritto come letterale APPOSTA. Un test che confronta il picco con la
    // costante si sposta insieme alla costante: togliendo il tetto passerebbe
    // lo stesso. Verificato il 6 agosto 2026 — quel test non cadeva.
    expect(MAX_DNS_IN_PARALLELO).toBe(50);
  });

  it("non supera mai 50 richieste in volo, con 400 domini da risolvere", async () => {
    const { r, picco } = conContatore();
    const indirizzi = Array.from({ length: 400 }, (_, i) => `persona${i}@azienda${i}.com`);
    await buildEmailLookup(indirizzi, r);
    expect(picco()).toBeLessThanOrEqual(50);
    // E deve essere molto sotto il numero di domini: è la prova che il tetto
    // c'è davvero, non che il caso ha voluto bene.
    expect(picco()).toBeLessThan(400);
  });

  it("il tetto è comunque un tetto, non un collo di bottiglia da uno alla volta", async () => {
    const { r, picco } = conContatore();
    const indirizzi = Array.from({ length: 400 }, (_, i) => `persona${i}@azienda${i}.com`);
    await buildEmailLookup(indirizzi, r);
    expect(picco()).toBeGreaterThan(1);
  });

  it("con meno domini del tetto non si inventa lavoro in più", async () => {
    const { r, picco } = conContatore();
    await buildEmailLookup(["a@uno.com", "b@due.com", "c@tre.com"], r);
    expect(picco()).toBeLessThanOrEqual(3);
  });

  it("tutti i domini vengono comunque risolti: il tetto non ne perde nessuno", async () => {
    const contatore = { n: 0 };
    const indirizzi = Array.from({ length: 300 }, (_, i) => `persona${i}@azienda${i}.com`);
    const l = await buildEmailLookup(indirizzi, risolutore({}, contatore));
    expect(contatore.n).toBe(300);
    for (const a of indirizzi) expect(l(a).verdict).toBe("undecidable");
  });

  it("un indirizzo ripetuto non si risolve due volte", async () => {
    const contatore = { n: 0 };
    const l = await buildEmailLookup(
      ["mario@azienda.com", "mario@azienda.com", "  MARIO@AZIENDA.COM  "],
      risolutore({}, contatore),
    );
    expect(contatore.n).toBe(1);
    expect(l("mario@azienda.com").verdict).toBe("undecidable");
  });

  it("il costo cresce con la lista, non col suo quadrato", async () => {
    // Fino al 6 agosto 2026 ogni indirizzo veniva confrontato con TUTTI quelli
    // già visti, ricostruendo ogni volta l'elenco delle liste per dominio:
    // quadratico. Misurato allora, con risolutore finto e un dominio ogni tre
    // indirizzi: 5.000 -> 335 ms, 40.000 -> 8.114 ms.
    //
    // Si misura un RAPPORTO, non un tempo. Una soglia assoluta dipende da
    // quanto è carica la macchina e da quanto rallenta la strumentazione della
    // copertura — infatti al primo tentativo è caduta per 10 ms su 4.000.
    // Il rapporto invece non dipende dalla velocità: con 8 volte i dati, un
    // costo lineare cresce ~8 volte, uno quadratico ~64. Il vecchio codice qui
    // cresceva di 24 volte; questo di circa 8.
    const tempo = async (n: number): Promise<number> => {
      const indirizzi = Array.from(
        { length: n },
        (_, i) => `persona${i}@azienda${Math.floor(i / 3)}.com`,
      );
      const inizio = Date.now();
      await buildEmailLookup(indirizzi, async () => VIVO);
      return Date.now() - inizio;
    };

    const piccolo = await tempo(5_000);
    const grande = await tempo(40_000);

    // Il pavimento di 250 ms evita che un `piccolo` vicino a zero renda il
    // rapporto insensato su una macchina veloce.
    expect(grande).toBeLessThan(Math.max(250, piccolo * 20));
  });
});
