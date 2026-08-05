import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { Delivery } from "./index.js";

/**
 * Consegna in locale: il file finisce su disco e si restituisce il percorso.
 *
 * Nessun deposito in memoria, nessuna scadenza, nessun URL pubblico. Quando il
 * server gira sulla macchina dell'utente questi non sono compromessi accettati,
 * sono problemi che non esistono.
 */

/** Cartella di destinazione, in ordine di preferenza. */
function cartellaDiUscita(): string {
  const scelta = process.env.CASHFLOW13_OUTPUT_DIR;
  if (scelta && scelta.trim() !== "") return resolve(scelta.trim());

  // Downloads esiste quasi ovunque ed e' dove l'utente va a cercare i file.
  const download = join(homedir(), "Downloads");
  if (existsSync(download)) return download;

  const home = homedir();
  if (existsSync(home)) return home;

  return tmpdir();
}

/**
 * Non sovrascrive un file esistente: chi ha rifatto il piano tre volte vuole
 * ritrovarsi tre file, non scoprire che il primo e' sparito.
 */
function nomeLibero(cartella: string, filename: string): string {
  const punto = filename.lastIndexOf(".");
  const base = punto === -1 ? filename : filename.slice(0, punto);
  const est = punto === -1 ? "" : filename.slice(punto);

  let candidato = join(cartella, filename);
  for (let n = 2; existsSync(candidato) && n < 1000; n++) {
    candidato = join(cartella, `${base}-${n}${est}`);
  }
  return candidato;
}

export async function deliverToDisk(
  data: Buffer,
  filename: string,
): Promise<Delivery> {
  const cartella = cartellaDiUscita();
  await mkdir(cartella, { recursive: true });
  const percorso = nomeLibero(cartella, filename);
  await writeFile(percorso, data);
  return { kind: "file", location: percorso };
}
