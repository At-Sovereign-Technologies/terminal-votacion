// Lee el deployment.yml y terminal-config.json al arrancar la terminal.
// Espejo del modelo de despliegue del proyecto: el Servidor Electoral
// genera estos archivos antes de la jornada y se distribuyen junto al SPA.
//
// Estrategia de carga:
//   - Ambos archivos se publican como assets estáticos en `/public/`.
//   - La terminal los descarga al arranque con fetch.
//   - Si alguno falta o está malformado, la terminal entra en modo "ERROR" y
//     no permite votar.
//
// PROD: el operador del puesto reemplaza los placeholders de `/public/`
// con los archivos reales generados por el Servidor Electoral.

import { parse as parseYaml } from "yaml";
import type {
    Deployment,
    DeploymentPunto,
    DeploymentTerminal,
    TerminalConfig,
} from "../types/deployment";

const ENV = import.meta.env as unknown as {
    VITE_DEPLOYMENT_PATH?: string;
    VITE_TERMINAL_CONFIG_PATH?: string;
    VITE_TERMINAL_ID?: string;
    VITE_TERMINAL_SECRETO?: string;
    VITE_TERMINAL_CLAVE_PRIVADA?: string;
    VITE_PARENT_URL?: string;
};

const DEPLOYMENT_PATH = ENV.VITE_DEPLOYMENT_PATH?.trim() || "/deployment.yml";
const CONFIG_PATH = ENV.VITE_TERMINAL_CONFIG_PATH?.trim() || "/terminal-config.json";

export interface ContextoTerminal {
    deployment: Deployment;
    config: TerminalConfig;
    punto: DeploymentPunto;
    terminal: DeploymentTerminal;
}

export class ErrorConfiguracion extends Error {
    razon: string;
    constructor(razon: string) {
        super(razon);
        this.razon = razon;
        this.name = "ErrorConfiguracion";
    }
}

async function fetchTexto(path: string): Promise<string> {
    const r = await fetch(path, { cache: "no-store" });
    if (!r.ok) {
        throw new ErrorConfiguracion(
            `No se pudo cargar ${path} (HTTP ${r.status}).`
        );
    }
    return r.text();
}

async function fetchTextoOpcional(path: string): Promise<string | null> {
    try {
        return await fetchTexto(path);
    } catch {
        return null;
    }
}

function construirConfigDesdeEnv(base?: TerminalConfig): TerminalConfig {
    const id = Number(ENV.VITE_TERMINAL_ID ?? base?.id ?? 0);
    return {
        id,
        secreto: ENV.VITE_TERMINAL_SECRETO?.trim() || base?.secreto || "",
        clavePrivada: ENV.VITE_TERMINAL_CLAVE_PRIVADA?.trim() || base?.clavePrivada || "",
        parentUrl: ENV.VITE_PARENT_URL?.trim() || base?.parentUrl || "",
    };
}

export async function cargarContextoTerminal(): Promise<ContextoTerminal> {
    const [yamlTexto, configTexto] = await Promise.all([
        fetchTexto(DEPLOYMENT_PATH),
        fetchTextoOpcional(CONFIG_PATH),
    ]);

    let deployment: Deployment;
    try {
        deployment = parseYaml(yamlTexto) as Deployment;
    } catch (e) {
        throw new ErrorConfiguracion(
            `deployment.yml mal formado: ${e instanceof Error ? e.message : String(e)}`
        );
    }

    let configBase: TerminalConfig | undefined;
    if (configTexto) {
        try {
            configBase = JSON.parse(configTexto) as TerminalConfig;
        } catch (e) {
            throw new ErrorConfiguracion(
                `terminal-config.json mal formado: ${e instanceof Error ? e.message : String(e)}`
            );
        }
    }

    const config = construirConfigDesdeEnv(configBase);

    // Validaciones mínimas.
    if (!config.id || !config.secreto || !config.clavePrivada || !config.parentUrl) {
        throw new ErrorConfiguracion(
            "Configuración incompleta: faltan id, secreto, clavePrivada o parentUrl (env o terminal-config.json)."
        );
    }
    if (!deployment.puntos?.length) {
        throw new ErrorConfiguracion("deployment.yml no contiene puntos.");
    }

    // Filtrar la información que corresponde a esta terminal específica.
    let puntoEncontrado: DeploymentPunto | undefined;
    let terminalEncontrada: DeploymentTerminal | undefined;
    for (const punto of deployment.puntos) {
        const t = punto.terminales.find((x) => x.id === config.id);
        if (t) {
            puntoEncontrado = punto;
            terminalEncontrada = t;
            break;
        }
    }

    if (!puntoEncontrado || !terminalEncontrada) {
        throw new ErrorConfiguracion(
            `Terminal id=${config.id} no encontrada en deployment.yml.`
        );
    }

    if (!terminalEncontrada.activo) {
        throw new ErrorConfiguracion(
            `Terminal id=${config.id} marcada como inactiva por el Servidor Electoral.`
        );
    }

    if (!puntoEncontrado.activo) {
        throw new ErrorConfiguracion(
            `Punto id=${puntoEncontrado.id} marcado como inactivo por el Servidor Electoral.`
        );
    }

    return {
        deployment,
        config,
        punto: puntoEncontrado,
        terminal: terminalEncontrada,
    };
}
