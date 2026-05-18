import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { cargarContextoTerminal, ErrorConfiguracion } from "./deploymentLoader";
import type { ContextoTerminal } from "./deploymentLoader";
import { usePollingRevocacion } from "./usePollingRevocacion";

type Estado =
    | { fase: "cargando" }
    | { fase: "listo"; ctx: ContextoTerminal }
    | { fase: "error"; mensaje: string };

const TerminalCtx = createContext<Estado>({ fase: "cargando" });

export function TerminalProvider({ children }: { children: ReactNode }) {
    const [estado, setEstado] = useState<Estado>({ fase: "cargando" });

    useEffect(() => {
        cargarContextoTerminal()
            .then((ctx) => setEstado({ fase: "listo", ctx }))
            .catch((e) => {
                const mensaje =
                    e instanceof ErrorConfiguracion
                        ? e.razon
                        : e instanceof Error
                          ? e.message
                          : "Error desconocido al cargar configuración.";
                setEstado({ fase: "error", mensaje });
            });
    }, []);

    // Polling de revocación en caliente. Solo activo cuando la terminal ya
    // está lista (config cargada). Si el Servidor Electoral marca este punto
    // o esta terminal como inactivos, forzamos a fase "error" para que la
    // UI bloquee al votante inmediatamente.
    usePollingRevocacion(
        estado.fase === "listo"
            ? {
                  clusterUrl: estado.ctx.config.clusterUrl,
                  secreto: estado.ctx.config.secreto,
                  puntoId: estado.ctx.punto.id,
                  terminalId: estado.ctx.terminal.id,
                  onRevocacion: (motivo) =>
                      setEstado({ fase: "error", mensaje: motivo }),
              }
            : null
    );

    return (
        <TerminalCtx.Provider value={estado}>{children}</TerminalCtx.Provider>
    );
}

export function useTerminalContext(): Estado {
    return useContext(TerminalCtx);
}

// Helper para usar dentro de páginas que SOLO se renderizan en fase "listo".
export function useContextoListo(): ContextoTerminal {
    const e = useContext(TerminalCtx);
    if (e.fase !== "listo") {
        throw new Error(
            "useContextoListo llamado antes de que la terminal estuviera lista."
        );
    }
    return e.ctx;
}
