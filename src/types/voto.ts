// Contrato con POST /votar del Nodo de Votación Activa.
// La estructura `voto` es lo que viaja en claro y lo que se firma.
// La firma Ed25519 se calcula sobre la serialización canónica de `voto`.

export interface VotoPayload {
    terminal: number;
    votante: number;
    // Voto simple (mayoría) → un único candidato.
    // Voto alternativo (ME-04) → candidato = 0 y `preferencias` lleva el ranking.
    // Voto en blanco → candidato = 0 y `preferencias` vacío.
    candidato: number;
    preferencias?: Record<string, number>;
}

export interface VotoFirmado {
    voto: VotoPayload;
    firma: string; // Ed25519 en hex
}

export interface RespuestaVotanteIdentidad {
    votado: boolean;
}

// Lo que la Terminal de Jurado envía al endpoint local /handshake de
// la Terminal de Votación cuando autoriza una sesión.
//
// `sesionToken` es un JWT firmado por el secreto del Jurado que la
// Terminal de Voto puede verificar antes de mostrar el tarjetón.
export interface HandshakePayload {
    votanteId: number;
    sesionToken: string;
}
