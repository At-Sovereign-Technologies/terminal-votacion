// Firma Ed25519 del voto antes de enviarlo al Nodo.
// La clave privada vive solo en memoria; nunca sale por HTTP. La clave pública
// está en deployment.yml y el Nodo la usa para verificar la firma.
//
// La serialización canónica del voto es JSON con keys ordenadas alfabéticamente,
// para que firma y verificación produzcan el mismo bytestream en cualquier orden.

import * as ed from "@noble/ed25519";
import type { VotoPayload } from "../types/voto";

function serializarCanonico(voto: VotoPayload): string {
    // Keys ordenadas alfabéticamente para que firma y verificación produzcan
    // el mismo bytestream sin importar el orden de inserción. Si hay
    // preferencias (voto alternativo ME-04), también se ordenan internamente.
    let prefsOrdenadas: Record<string, number> | undefined;
    if (voto.preferencias && Object.keys(voto.preferencias).length > 0) {
        prefsOrdenadas = {};
        for (const k of Object.keys(voto.preferencias).sort()) {
            prefsOrdenadas[k] = voto.preferencias[k];
        }
    }
    return JSON.stringify({
        candidato: voto.candidato,
        ...(prefsOrdenadas ? { preferencias: prefsOrdenadas } : {}),
        terminal: voto.terminal,
        votante: voto.votante,
    });
}

function decodificarClavePrivada(raw: string): Uint8Array {
    // Acepta hex (64 chars) o base64.
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
        const bytes = new Uint8Array(32);
        for (let i = 0; i < 32; i++) {
            bytes[i] = parseInt(raw.slice(i * 2, i * 2 + 2), 16);
        }
        return bytes;
    }
    // Base64 fallback.
    const bin = atob(raw);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

function bytesAHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

export async function firmarVoto(
    voto: VotoPayload,
    clavePrivadaRaw: string
): Promise<string> {
    const clave = decodificarClavePrivada(clavePrivadaRaw);
    const mensaje = new TextEncoder().encode(serializarCanonico(voto));
    const firma = await ed.signAsync(mensaje, clave);
    return bytesAHex(firma);
}

// Sanity check para arranque: verifica que la clave produce firmas válidas.
export async function verificarConClavePublica(
    voto: VotoPayload,
    firmaHex: string,
    clavePublicaHex: string
): Promise<boolean> {
    const firma = new Uint8Array(
        firmaHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16))
    );
    const pub = new Uint8Array(
        clavePublicaHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16))
    );
    const mensaje = new TextEncoder().encode(serializarCanonico(voto));
    return ed.verifyAsync(firma, mensaje, pub);
}
