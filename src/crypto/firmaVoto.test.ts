import { describe, expect, it } from "vitest";
import * as ed from "@noble/ed25519";
import { firmarVoto, verificarConClavePublica } from "./firmaVoto";
import type { VotoPayload } from "../types/voto";

function bytesAHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

async function generarParEd25519() {
    // 32 bytes pseudo-aleatorios (suficiente para test).
    const seed = new Uint8Array(32);
    for (let i = 0; i < 32; i++) seed[i] = (i * 7 + 13) & 0xff;
    const pub = await ed.getPublicKeyAsync(seed);
    return { privadaHex: bytesAHex(seed), publicaHex: bytesAHex(pub) };
}

describe("firmaVoto", () => {
    it("firma y verifica correctamente un voto simple", async () => {
        const { privadaHex, publicaHex } = await generarParEd25519();
        const voto: VotoPayload = {
            terminal: 1,
            votante: 101,
            candidato: 7,
        };
        const firma = await firmarVoto(voto, privadaHex);
        expect(typeof firma).toBe("string");
        expect(firma.length).toBeGreaterThan(0);

        const valida = await verificarConClavePublica(voto, firma, publicaHex);
        expect(valida).toBe(true);
    });

    it("rechaza una firma cuando se altera el candidato", async () => {
        const { privadaHex, publicaHex } = await generarParEd25519();
        const voto: VotoPayload = {
            terminal: 1,
            votante: 101,
            candidato: 7,
        };
        const firma = await firmarVoto(voto, privadaHex);
        const votoAlterado = { ...voto, candidato: 8 };
        const valida = await verificarConClavePublica(
            votoAlterado,
            firma,
            publicaHex
        );
        expect(valida).toBe(false);
    });

    it("firma con ranking produce serialización determinística independiente del orden de inserción", async () => {
        const { privadaHex, publicaHex } = await generarParEd25519();
        // El mismo ranking insertado en orden distinto debe generar la
        // misma firma (la serialización canónica ordena las keys).
        const voto1: VotoPayload = {
            terminal: 1,
            votante: 101,
            candidato: 0,
            preferencias: { c: 3, a: 1, b: 2 },
        };
        const voto2: VotoPayload = {
            terminal: 1,
            votante: 101,
            candidato: 0,
            preferencias: { a: 1, b: 2, c: 3 },
        };
        const firma1 = await firmarVoto(voto1, privadaHex);
        const firma2 = await firmarVoto(voto2, privadaHex);
        expect(firma1).toBe(firma2);

        const valida = await verificarConClavePublica(voto2, firma1, publicaHex);
        expect(valida).toBe(true);
    });

    it("ranking alterado invalida la firma", async () => {
        const { privadaHex, publicaHex } = await generarParEd25519();
        const voto: VotoPayload = {
            terminal: 1,
            votante: 101,
            candidato: 0,
            preferencias: { a: 1, b: 2, c: 3 },
        };
        const firma = await firmarVoto(voto, privadaHex);
        const votoAlterado = {
            ...voto,
            preferencias: { a: 2, b: 1, c: 3 }, // ordering cambiado
        };
        const valida = await verificarConClavePublica(
            votoAlterado,
            firma,
            publicaHex
        );
        expect(valida).toBe(false);
    });

    it("voto en blanco (candidato=0 sin preferencias) también firma y verifica", async () => {
        const { privadaHex, publicaHex } = await generarParEd25519();
        const voto: VotoPayload = {
            terminal: 1,
            votante: 101,
            candidato: 0,
        };
        const firma = await firmarVoto(voto, privadaHex);
        const valida = await verificarConClavePublica(voto, firma, publicaHex);
        expect(valida).toBe(true);
    });
});
