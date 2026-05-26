// Cliente WebSocket persistente Voto → Jurado.
//
// La Terminal de Voto es cliente puro: no escucha puertos. Mantiene una
// conexión WebSocket abierta hacia la Terminal de Jurado del mismo punto
// (parent_url) y por ese canal:
//   - Recibe HANDSHAKE cuando el jurado autoriza una sesión.
//   - Envía VOTO firmado cuando el votante confirma.
//   - Recibe VOTO_ACEPTADO o VOTO_RECHAZADO como respuesta.
//
// Reconexión automática con backoff lineal si la conexión cae.

import type {
    HandshakePayload,
    MensajeJurado,
    MensajeVoto,
    VotoFirmado,
} from "../types/voto";

export interface JuradoClient {
    estado(): EstadoConexion;
    enviarVoto(voto: VotoFirmado): Promise<RespuestaVoto>;
    cerrar(): void;
}

export type EstadoConexion = "conectando" | "abierto" | "cerrado";

export type RespuestaVoto =
    | { ok: true; numeroConfirmacion: string }
    | { ok: false; motivo: string };

export interface OpcionesCliente {
    parentUrl: string; // http://host:port o ws://host:port
    terminalId: number;
    secreto: string;
    jwt?: string;
    onHandshake: (h: HandshakePayload) => void;
    onCambioEstado?: (e: EstadoConexion) => void;
}

function pareceJwt(raw: string): boolean {
    return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw.trim());
}

function urlAWebSocket(raw: string): string {
    return raw
        .replace(/^http:\/\//i, "ws://")
        .replace(/^https:\/\//i, "wss://")
        .replace(/\/$/, "");
}

export function crearJuradoClient(opts: OpcionesCliente): JuradoClient {
    const wsUrl = urlAWebSocket(opts.parentUrl);
    let ws: WebSocket | null = null;
    let reintento: ReturnType<typeof setTimeout> | null = null;
    let cerrado = false;
    let estado: EstadoConexion = "conectando";

    // Las promesas de envío de voto se resuelven cuando llega VOTO_ACEPTADO
    // o VOTO_RECHAZADO. Solo hay UNA en curso a la vez (el votante emite un
    // voto por sesión).
    let resolverVotoPendiente: ((r: RespuestaVoto) => void) | null = null;

    const cambiarEstado = (nuevo: EstadoConexion) => {
        estado = nuevo;
        opts.onCambioEstado?.(nuevo);
    };

    const conectar = () => {
        if (cerrado) return;
        cambiarEstado("conectando");
        try {
            ws = new WebSocket(wsUrl);
        } catch {
            programarReintento();
            return;
        }

        ws.addEventListener("open", () => {
            cambiarEstado("abierto");
            // Identificarnos ante el Jurado para que sepa qué terminal somos.
            const jwtHello = opts.jwt?.trim() || (pareceJwt(opts.secreto) ? opts.secreto : undefined);
            enviar({
                tipo: "HELLO",
                terminalId: opts.terminalId,
                secreto: opts.secreto,
                ...(jwtHello ? { jwt: jwtHello } : {}),
            });
        });

        ws.addEventListener("message", (ev) => {
            try {
                const msg = JSON.parse(String(ev.data)) as MensajeJurado;
                switch (msg.tipo) {
                    case "HANDSHAKE":
                        opts.onHandshake({
                            votanteId: msg.votanteId,
                            sesionToken: msg.sesionToken,
                        });
                        break;
                    case "VOTO_ACEPTADO":
                        resolverVotoPendiente?.({
                            ok: true,
                            numeroConfirmacion: msg.numeroConfirmacion,
                        });
                        resolverVotoPendiente = null;
                        break;
                    case "VOTO_RECHAZADO":
                        resolverVotoPendiente?.({
                            ok: false,
                            motivo: msg.motivo,
                        });
                        resolverVotoPendiente = null;
                        break;
                    case "WELCOME":
                        // notificación informativa del Jurado; no acción.
                        break;
                }
            } catch {
                // ignorar mensajes mal formados
            }
        });

        ws.addEventListener("close", () => {
            cambiarEstado("cerrado");
            if (!cerrado) programarReintento();
            // Si había un voto pendiente, fallar para no dejar al usuario colgado.
            if (resolverVotoPendiente) {
                resolverVotoPendiente({
                    ok: false,
                    motivo: "Se perdió la conexión con la Terminal de Jurado.",
                });
                resolverVotoPendiente = null;
            }
        });
    };

    const enviar = (m: MensajeVoto) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return false;
        ws.send(JSON.stringify(m));
        return true;
    };

    const programarReintento = () => {
        if (reintento || cerrado) return;
        reintento = setTimeout(() => {
            reintento = null;
            conectar();
        }, 2_000);
    };

    conectar();

    return {
        estado: () => estado,
        enviarVoto(voto) {
            return new Promise<RespuestaVoto>((resolve) => {
                if (estado !== "abierto") {
                    resolve({
                        ok: false,
                        motivo:
                            "No hay conexión con la Terminal de Jurado. Espere a que se restablezca.",
                    });
                    return;
                }
                if (resolverVotoPendiente) {
                    resolve({
                        ok: false,
                        motivo: "Ya hay un voto pendiente de respuesta.",
                    });
                    return;
                }
                resolverVotoPendiente = resolve;
                const ok = enviar({ tipo: "VOTO", payload: voto });
                if (!ok) {
                    resolverVotoPendiente = null;
                    resolve({
                        ok: false,
                        motivo: "No se pudo enviar el voto por el WebSocket.",
                    });
                }
                // Timeout de seguridad: si el Jurado no responde en 10s,
                // resolvemos como rechazo.
                setTimeout(() => {
                    if (resolverVotoPendiente === resolve) {
                        resolverVotoPendiente = null;
                        resolve({
                            ok: false,
                            motivo:
                                "El Jurado no respondió a tiempo (10s). Reintente.",
                        });
                    }
                }, 10_000);
            });
        },
        cerrar() {
            cerrado = true;
            if (reintento) clearTimeout(reintento);
            ws?.close();
        },
    };
}
