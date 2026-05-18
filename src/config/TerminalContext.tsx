import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { cargarContextoTerminal, ErrorConfiguracion } from "./deploymentLoader";
import type { ContextoTerminal } from "./deploymentLoader";

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

    return (
        <TerminalCtx.Provider value={estado}>{children}</TerminalCtx.Provider>
    );
}

export function useTerminalContext(): Estado {
    return useContext(TerminalCtx);
}

export function useContextoListo(): ContextoTerminal {
    const e = useContext(TerminalCtx);
    if (e.fase !== "listo") {
        throw new Error(
            "useContextoListo llamado antes de que la terminal estuviera lista."
        );
    }
    return e.ctx;
}
