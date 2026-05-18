import { useEffect, useRef } from "react";
import { crearNodoClient } from "../api/nodo.api";

// Polling al Nodo cada N segundos para detectar si el Servidor Electoral
// revocó (marcó `activo: false`) este punto o esta terminal en caliente.
//
// Atributo de calidad cubierto: Control de Fraude.
// Si una máquina fue comprometida durante la jornada, el Servidor Electoral
// la marca como inactiva; el SPA debe enterarse sin reiniciar y dejar de
// aceptar nuevas sesiones.

export interface OpcionesPolling {
    clusterUrl: string;
    secreto: string;
    puntoId: number;
    terminalId: number;
    intervaloMs?: number;
    onRevocacion: (motivo: string) => void;
}

const INTERVALO_DEFAULT_MS = 30_000;

export function usePollingRevocacion(opts: OpcionesPolling | null) {
    // Guardamos el callback en una ref para que cambios en él no reseteen
    // el timer; el efecto solo depende de identificadores estables.
    const callbackRef = useRef(opts?.onRevocacion);
    callbackRef.current = opts?.onRevocacion;

    useEffect(() => {
        if (!opts) return;
        const { clusterUrl, secreto, puntoId, terminalId } = opts;
        const intervaloMs = opts.intervaloMs ?? INTERVALO_DEFAULT_MS;

        const nodo = crearNodoClient({ clusterUrl, secreto });
        let cancelado = false;
        let fallosConsecutivos = 0;

        const verificar = async () => {
            if (cancelado) return;
            try {
                const r = await nodo.consultarEstadoPuesto();
                fallosConsecutivos = 0;

                if (r.punto.id !== puntoId) return; // ignorar respuestas inesperadas
                if (!r.punto.activo) {
                    callbackRef.current?.(
                        "El Servidor Electoral revocó este punto de votación."
                    );
                    return;
                }
                const t = r.punto.terminales.find((x) => x.id === terminalId);
                if (t && !t.activo) {
                    callbackRef.current?.(
                        `El Servidor Electoral revocó esta terminal (#${terminalId}).`
                    );
                    return;
                }
            } catch {
                // Si el Nodo no responde, NO disparamos revocación: una caída
                // del nodo no es lo mismo que una revocación explícita.
                // Solo logueamos. Después de 3 fallos seguidos, advertimos
                // en consola pero no bloqueamos al votante.
                fallosConsecutivos++;
                if (fallosConsecutivos === 3) {
                    console.warn(
                        "[polling] el Nodo de Votación no responde después de 3 intentos. Se sigue intentando."
                    );
                }
            }
        };

        // Primera verificación inmediata; luego cada intervaloMs.
        verificar();
        const id = setInterval(verificar, intervaloMs);

        return () => {
            cancelado = true;
            clearInterval(id);
        };
    }, [
        opts?.clusterUrl,
        opts?.secreto,
        opts?.puntoId,
        opts?.terminalId,
        opts?.intervaloMs,
        // onRevocacion intencionalmente fuera: usamos ref para evitar resets.
    ]);
}
