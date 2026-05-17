// Cliente HTTP del Nodo de Votación Activa.
// La terminal usa el JWT de su config (`config.secreto`) como Bearer.

import axios, { type AxiosInstance } from "axios";
import type {
    HandshakePayload,
    RespuestaVotanteIdentidad,
    VotoFirmado,
} from "../types/voto";

export interface NodoClient {
    consultarVotante(documento: string): Promise<RespuestaVotanteIdentidad>;
    emitirVoto(payload: VotoFirmado): Promise<void>;
    notificarJurado(parentUrl: string, evento: EventoJurado): Promise<void>;
}

export interface EventoJurado {
    tipo: "VOTO_EMITIDO" | "SESION_CANCELADA";
    terminalId: number;
    votanteId?: number;
}

export function crearNodoClient(opts: {
    clusterUrl: string;
    secreto: string;
}): NodoClient {
    const http: AxiosInstance = axios.create({
        baseURL: opts.clusterUrl.replace(/\/$/, ""),
        timeout: 5000,
        headers: {
            Authorization: `Bearer ${opts.secreto}`,
            "Content-Type": "application/json",
        },
    });

    return {
        async consultarVotante(documento) {
            const r = await http.get<RespuestaVotanteIdentidad>(
                `/votante/${encodeURIComponent(documento)}`
            );
            return r.data;
        },

        async emitirVoto(payload) {
            await http.post("/votar", payload);
        },

        async notificarJurado(parentUrl, evento) {
            // POST al endpoint local del jurado (parent_url).
            // No usamos el cliente con baseURL porque parentUrl puede ser
            // una URL local distinta al cluster.
            await axios.post(
                `${parentUrl.replace(/\/$/, "")}/eventos`,
                evento,
                {
                    timeout: 3000,
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${opts.secreto}`,
                    },
                }
            );
        },
    };
}

// Espera el payload del handshake desde un objeto recibido vía postMessage,
// query param, o cualquier otra vía de entrega (mientras Augusto define el
// transporte real). Hoy aceptamos handshake por query string para dev:
//   /votar?handshake=<base64-json>
export function decodificarHandshakeDeQuery(
    queryValue: string | null
): HandshakePayload | null {
    if (!queryValue) return null;
    try {
        const json = atob(decodeURIComponent(queryValue));
        const parsed = JSON.parse(json) as HandshakePayload;
        if (typeof parsed.votanteId !== "number" || !parsed.sesionToken) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}
