// Cliente del sidecar de desarrollo. Escucha el WebSocket en :8091 y dispara
// un callback cada vez que llega un handshake.
//
// Cuando el equipo defina el transporte real (Electron/Tauri/launcher
// embebido), este archivo se reemplaza por el adaptador real. La interfaz
// pública (`subscribirseAHandshakes`) no cambia.

import type { HandshakePayload } from "../types/voto";

const URL_DEFAULT =
    (typeof window !== "undefined" &&
        (window as unknown as { __SIDECAR_WS_URL__?: string })
            .__SIDECAR_WS_URL__) ||
    "ws://localhost:8091";

type Mensaje =
    | { tipo: "WELCOME"; mensaje?: string }
    | ({ tipo: "HANDSHAKE" } & HandshakePayload);

export interface SuscripcionSidecar {
    cerrar: () => void;
    estado: () => "conectando" | "abierto" | "cerrado";
}

export function subscribirseAHandshakes(
    onHandshake: (h: HandshakePayload) => void,
    onConexion?: (estado: "conectando" | "abierto" | "cerrado") => void
): SuscripcionSidecar {
    let ws: WebSocket | null = null;
    let reintento: ReturnType<typeof setTimeout> | null = null;
    let cerrado = false;

    const conectar = () => {
        if (cerrado) return;
        onConexion?.("conectando");
        try {
            ws = new WebSocket(URL_DEFAULT);
        } catch {
            programarReintento();
            return;
        }

        ws.addEventListener("open", () => {
            onConexion?.("abierto");
        });

        ws.addEventListener("message", (ev) => {
            try {
                const msg = JSON.parse(String(ev.data)) as Mensaje;
                if (msg.tipo === "HANDSHAKE") {
                    onHandshake({
                        votanteId: msg.votanteId,
                        sesionToken: msg.sesionToken,
                    });
                }
            } catch {
                // ignorar mensajes mal formados
            }
        });

        ws.addEventListener("close", () => {
            onConexion?.("cerrado");
            if (!cerrado) programarReintento();
        });

        ws.addEventListener("error", () => {
            // El close vendrá detrás; el reintento se programa allí.
        });
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
        cerrar: () => {
            cerrado = true;
            if (reintento) clearTimeout(reintento);
            ws?.close();
        },
        estado: () =>
            ws?.readyState === WebSocket.OPEN
                ? "abierto"
                : ws?.readyState === WebSocket.CONNECTING
                  ? "conectando"
                  : "cerrado",
    };
}
