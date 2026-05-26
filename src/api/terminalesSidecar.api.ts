export interface TerminalDisponible {
    id: number;
    activo: boolean;
    conectada: boolean;
    disponible: boolean;
    votantesAsignados: number;
}

interface SidecarTerminalesResponse {
    terminales?: TerminalDisponible[];
}

function parentUrlAHttp(raw: string): string {
    const httpBase = raw
        .replace(/^ws:\/\//i, "http://")
        .replace(/^wss:\/\//i, "https://")
        .replace(/\/$/, "");

    // Convención del sidecar demo: WS voto en 8090 y HTTP API en 8089.
    try {
        const u = new URL(httpBase);
        if (u.port === "8090") u.port = "8089";
        return u.toString().replace(/\/$/, "");
    } catch {
        return httpBase;
    }
}

export async function consultarTerminalesDisponibles(
    parentUrl: string
): Promise<TerminalDisponible[]> {
    const base = parentUrlAHttp(parentUrl);
    const r = await fetch(`${base}/terminales`, {
        signal: AbortSignal.timeout(3_000),
    });

    if (!r.ok) {
        throw new Error(`El sidecar respondió HTTP ${r.status} al consultar /terminales.`);
    }

    const data = (await r.json().catch(() => ({}))) as SidecarTerminalesResponse;
    return Array.isArray(data.terminales) ? data.terminales : [];
}
