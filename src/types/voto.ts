// Contrato del voto que viaja por WebSocket entre Terminal Voto y Terminal Jurado.
// La estructura `voto` es lo que se firma con Ed25519; el Nodo (al que el
// Jurado le reenvía el voto) verifica la firma usando la clavePublica
// del deployment.yml.

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

// Lo que la Terminal de Jurado envía a la Terminal de Votación cuando
// autoriza una sesión. Llega por el mismo WebSocket que la Voto mantiene
// abierto al Jurado.
export interface HandshakePayload {
    votanteId: number;
    sesionToken: string;
}

// Mensajes del WebSocket Voto ↔ Jurado.
export type MensajeJurado =
    | { tipo: "WELCOME"; mensaje?: string }
    | ({ tipo: "HANDSHAKE" } & HandshakePayload)
    | { tipo: "VOTO_ACEPTADO"; numeroConfirmacion: string }
    | { tipo: "VOTO_RECHAZADO"; motivo: string };

export type MensajeVoto =
    | { tipo: "HELLO"; terminalId: number; secreto: string }
    | { tipo: "VOTO"; payload: VotoFirmado };
