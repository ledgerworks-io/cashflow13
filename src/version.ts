import { readFileSync } from "node:fs";

/**
 * La versione viene letta da package.json invece di essere ricopiata qui:
 * una sola fonte, nessuna deriva fra il pacchetto e quello che il server dichiara.
 * Il percorso vale sia da `src/` (dev) sia da `dist/` (produzione): entrambi
 * stanno un livello sotto la radice del pacchetto.
 */
const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { name: string; version: string };

export const PACKAGE_NAME = pkg.name;
export const VERSION = pkg.version;
