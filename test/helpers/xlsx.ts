import { inflateRawSync } from "node:zlib";

/**
 * Estrae un file dall'archivio .xlsx senza dipendenze esterne.
 *
 * Serve perché ExcelJS, quando rilegge una cartella, non ripristina tutto quello
 * che ha scritto — `calcProperties` per esempio. Verificare il round-trip della
 * libreria non dimostra niente sul file che riceve l'utente: l'unica prova che
 * conta è l'XML dentro l'archivio.
 */
export function entryFromZip(zip: Buffer, name: string): string {
  // Fine del direttorio centrale: firma PK\x05\x06, cercata dal fondo.
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("non è un archivio zip");

  const conta = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);

  for (let i = 0; i < conta; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error("direttorio centrale corrotto");
    const metodo = zip.readUInt16LE(p + 10);
    const dimCompressa = zip.readUInt32LE(p + 20);
    const lungNome = zip.readUInt16LE(p + 28);
    const lungExtra = zip.readUInt16LE(p + 30);
    const lungCommento = zip.readUInt16LE(p + 32);
    const offsetLocale = zip.readUInt32LE(p + 42);
    const nome = zip.subarray(p + 46, p + 46 + lungNome).toString("utf8");

    if (nome === name) {
      const nomeLocale = zip.readUInt16LE(offsetLocale + 26);
      const extraLocale = zip.readUInt16LE(offsetLocale + 28);
      const inizio = offsetLocale + 30 + nomeLocale + extraLocale;
      const dati = zip.subarray(inizio, inizio + dimCompressa);
      return metodo === 0 ? dati.toString("utf8") : inflateRawSync(dati).toString("utf8");
    }
    p += 46 + lungNome + lungExtra + lungCommento;
  }
  throw new Error(`voce non trovata nell'archivio: ${name}`);
}
