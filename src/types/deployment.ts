// Espejo del deployment.yml generado por el Servidor Electoral antes de la jornada.
// El archivo se distribuye junto al SPA y contiene TODA la configuración necesaria
// para que la terminal opere sin tener que pedir nada al arranque.
//
// Cada terminal lee este archivo + su propio terminal-config.json y filtra
// la información que le corresponde por id.

export interface DeploymentEleccion {
    id: number;
    nombre: string;
    tipoEleccion: "presidencial" | "legislativa" | "territorial";
    fechaInicio: number; // unix timestamp segundos
    fechaFin: number;
}

export interface DeploymentCandidato {
    id: number;
    nombre: string;
    documento: string;
    partido: string;
    fotoUrl?: string;
}

export interface DeploymentJurado {
    id: number;
    nombre: string;
    documento: string;
    usuario: string;
    // hash de Argon2 — no se usa en la terminal de votación, solo en la del jurado.
    hash?: string;
}

export interface DeploymentVotante {
    id: number;
    nombre: string;
    documento: string;
}

export interface DeploymentTerminal {
    id: number;
    // JWT bearer que la terminal usa al hablar con el Nodo.
    // Solo el Servidor Electoral tiene la facultad de revocarlo.
    secreto?: string;
    clavePublica: string;
    activo: boolean;
    votantes: DeploymentVotante[];
}

export interface DeploymentPunto {
    id: number;
    nombre: string;
    latitud: number;
    longitud: number;
    activo: boolean;
    secreto?: string;
    jurados: DeploymentJurado[];
    terminales: DeploymentTerminal[];
}

export interface Deployment {
    eleccion: DeploymentEleccion;
    candidatos: DeploymentCandidato[];
    puntos: DeploymentPunto[];
}

// Config local de la propia terminal (deploy individual por máquina).
// La Terminal de Voto NO habla con el Nodo directamente: toda comunicación
// con el exterior pasa por la Terminal de Jurado del mismo punto vía
// WebSocket. El Jurado actúa como proxy hacia el Nodo y como buffer en
// caso de desconexión del Nodo.
export interface TerminalConfig {
    id: number;
    secreto: string; // JWT bearer para identificarse ante el Jurado.
    jwt?: string; // JWT explícito para sidecar/nodo cuando aplique.
    clavePrivada: string; // Ed25519, hex o base64. Nunca se serializa hacia afuera.
    parentUrl: string; // URL del Jurado (acepta http://host:port o ws://host:port).
}
