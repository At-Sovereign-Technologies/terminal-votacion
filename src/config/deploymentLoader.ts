// Carga configuración de runtime desde:
//  1) terminal-config.json (o variables VITE_*) para datos locales de la terminal.
//  2) /puesto del sidecar, cuya fuente de verdad es active-voting-service.

import type {
    Deployment,
    DeploymentPunto,
    DeploymentTerminal,
    TerminalConfig,
} from "../types/deployment";

const ENV = import.meta.env as unknown as {
    VITE_TERMINAL_CONFIG_PATH?: string;
    VITE_TERMINAL_ID?: string;
    VITE_TERMINAL_SECRETO?: string;
    VITE_TERMINAL_JWT?: string;
    VITE_TERMINAL_CLAVE_PRIVADA?: string;
    VITE_PARENT_URL?: string;
    VITE_SIDECAR_URL?: string;
};

const CONFIG_PATH = ENV.VITE_TERMINAL_CONFIG_PATH?.trim() || "/terminal-config.json";

interface PuestoApiResponse {
    eleccion?: {
        id?: number;
        nombre?: string;
        tipo_eleccion?: "presidencial" | "legislativa" | "territorial";
        fecha_inicio?: number;
        fecha_fin?: number;
    };
    candidatos?: Array<{
        id?: number;
        nombre?: string;
        documento?: string;
        partido?: string;
        foto_url?: string;
    }>;
    punto?: {
        id?: number;
        nombre?: string;
        latitud?: number;
        longitud?: number;
        terminales?: Array<{
            id?: number;
            activo?: boolean;
            votantes?: Array<{
                id?: number;
                nombre?: string;
                documento?: string;
            }>;
        }>;
    };
}

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
        jwt: ENV.VITE_TERMINAL_JWT?.trim() || base?.jwt || "",
        clavePrivada: ENV.VITE_TERMINAL_CLAVE_PRIVADA?.trim() || base?.clavePrivada || "",
        parentUrl: ENV.VITE_PARENT_URL?.trim() || base?.parentUrl || "",
    };
}

interface TerminalConfigRaw {
    id?: number | string;
    secreto?: string;
    jwt?: string;
    clavePrivada?: string;
    clave_privada?: string;
    parentUrl?: string;
    parent_url?: string;
    cluster_url?: string;
}

function mapearConfigRaw(raw: TerminalConfigRaw): TerminalConfig {
    return {
        id: Number(raw.id ?? 0),
        secreto: String(raw.secreto ?? "").trim(),
        jwt: String(raw.jwt ?? "").trim(),
        clavePrivada: String(raw.clavePrivada ?? raw.clave_privada ?? "").trim(),
        // Compatibilidad de formatos: parentUrl (actual), parent_url y cluster_url.
        parentUrl: String(raw.parentUrl ?? raw.parent_url ?? raw.cluster_url ?? "").trim(),
    };
}

function parentUrlAHttp(raw: string): string {
    const httpBase = raw
        .replace(/^ws:\/\//i, "http://")
        .replace(/^wss:\/\//i, "https://")
        .replace(/\/$/, "");

    try {
        const u = new URL(httpBase);
        if (u.port === "8090") u.port = "8089";
        return u.toString().replace(/\/$/, "");
    } catch {
        return httpBase;
    }
}

async function fetchPuesto(config: TerminalConfig): Promise<PuestoApiResponse> {
    const sidecarBase =
        ENV.VITE_SIDECAR_URL?.trim() || parentUrlAHttp(config.parentUrl);
    const r = await fetch(`${sidecarBase}/puesto`, { cache: "no-store" });
    if (!r.ok) {
        throw new ErrorConfiguracion(
            `No se pudo cargar /puesto del sidecar (HTTP ${r.status}).`
        );
    }
    const data = (await r.json().catch(() => null)) as PuestoApiResponse | null;
    if (!data || typeof data !== "object") {
        throw new ErrorConfiguracion("Respuesta inválida en GET /puesto.");
    }
    return data;
}

function mapearPuestoApiADeployment(api: PuestoApiResponse): Deployment {
    const eleccion = api.eleccion;
    const punto = api.punto;

    if (!eleccion || !punto) {
        throw new ErrorConfiguracion(
            "GET /puesto incompleto: faltan eleccion o punto."
        );
    }

    return {
        eleccion: {
            id: Number(eleccion.id ?? 1),
            nombre: String(eleccion.nombre ?? ""),
            tipoEleccion: eleccion.tipo_eleccion ?? "presidencial",
            fechaInicio: Number(eleccion.fecha_inicio ?? 0),
            fechaFin: Number(eleccion.fecha_fin ?? 0),
        },
        candidatos: (api.candidatos ?? []).map((c) => ({
            id: Number(c.id ?? 0),
            nombre: String(c.nombre ?? ""),
            documento: String(c.documento ?? ""),
            partido: String(c.partido ?? ""),
            fotoUrl: c.foto_url,
        })),
        puntos: [
            {
                id: Number(punto.id ?? 1),
                nombre: String(punto.nombre ?? ""),
                latitud: Number(punto.latitud ?? 0),
                longitud: Number(punto.longitud ?? 0),
                activo: true,
                jurados: [],
                terminales: (punto.terminales ?? []).map((t) => ({
                    id: Number(t.id ?? 0),
                    secreto: "",
                    clavePublica: "",
                    activo: t.activo !== false,
                    votantes: (t.votantes ?? []).map((v) => ({
                        id: Number(v.id ?? 0),
                        nombre: String(v.nombre ?? ""),
                        documento: String(v.documento ?? ""),
                    })),
                })),
            },
        ],
    };
}

export async function cargarContextoTerminal(): Promise<ContextoTerminal> {
    const configTexto = await fetchTextoOpcional(CONFIG_PATH);

    let configBase: TerminalConfig | undefined;
    if (configTexto) {
        try {
            configBase = mapearConfigRaw(JSON.parse(configTexto) as TerminalConfigRaw);
        } catch (e) {
            throw new ErrorConfiguracion(
                `terminal-config.json mal formado: ${e instanceof Error ? e.message : String(e)}`
            );
        }
    }

    const config = construirConfigDesdeEnv(configBase);

    let deployment: Deployment;
    try {
        const puestoApi = await fetchPuesto(config);
        deployment = mapearPuestoApiADeployment(puestoApi);
    } catch (e) {
        throw new ErrorConfiguracion(
            e instanceof Error ? e.message : "No se pudo cargar configuración desde sidecar."
        );
    }

    // Validaciones mínimas.
    if (!config.id || !config.secreto || !config.clavePrivada || !config.parentUrl) {
        throw new ErrorConfiguracion(
            "Configuración incompleta: faltan id, secreto, clavePrivada o parentUrl (env o terminal-config.json)."
        );
    }
    if (!deployment.puntos?.length) {
        throw new ErrorConfiguracion("/puesto no contiene puntos.");
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
            `Terminal id=${config.id} no encontrada en /puesto.`
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
