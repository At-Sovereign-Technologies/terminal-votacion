// Sidecar HTTP local para recibir handshakes del Jurado en desarrollo.
//
// PROBLEMA: un SPA en browser no puede escuchar HTTP entrante. Pero el modelo
// del proyecto dice que la Terminal de Jurado le hace `POST /handshake` a la
// Terminal de Votación por HTTP local (DNS interno del puesto).
//
// SOLUCIÓN dev: este proceso Node corre paralelo al SPA. Escucha POST en
// :8090/handshake y reenvía cada handshake al SPA por WebSocket en
// ws://localhost:8091.
//
// PROD: cuando el equipo decida (Electron / Tauri / launcher embebido /
// sidecar empaquetado), se reemplaza este archivo por el integrador real.
// La interfaz pública del SPA (WebSocket) se mantiene.

import express, { type Request, type Response } from "express";
import cors from "cors";
import { createServer } from "http";
import { WebSocketServer } from "ws";

const HTTP_PORT = Number(process.env.SIDECAR_HTTP_PORT ?? 8090);
const WS_PORT = Number(process.env.SIDECAR_WS_PORT ?? 8091);

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const wss = new WebSocketServer({ port: WS_PORT });

console.log(`[sidecar] HTTP   → http://localhost:${HTTP_PORT}`);
console.log(`[sidecar] WS     → ws://localhost:${WS_PORT}`);

wss.on("connection", (ws) => {
    console.log("[sidecar] SPA conectado al WebSocket");
    ws.send(JSON.stringify({ tipo: "WELCOME", mensaje: "Sidecar conectado." }));

    ws.on("close", () => {
        console.log("[sidecar] SPA desconectado");
    });
});

function difundir(payload: object) {
    const json = JSON.stringify(payload);
    let entregados = 0;
    wss.clients.forEach((ws) => {
        if (ws.readyState === ws.OPEN) {
            ws.send(json);
            entregados++;
        }
    });
    return entregados;
}

// Endpoint que llamaría la Terminal de Jurado.
app.post("/handshake", (req: Request, res: Response) => {
    const { votanteId, sesionToken } = req.body ?? {};
    if (typeof votanteId !== "number" || typeof sesionToken !== "string") {
        return res.status(400).json({
            error: "Payload inválido. Esperado: { votanteId: number, sesionToken: string }",
        });
    }
    const entregados = difundir({ tipo: "HANDSHAKE", votanteId, sesionToken });
    console.log(
        `[sidecar] handshake recibido votanteId=${votanteId} entregadoA=${entregados} SPA(s)`
    );
    return res.status(200).json({ ok: true, entregadoA: entregados });
});

// Endpoint healthcheck para que el SPA verifique que el sidecar está vivo.
app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

httpServer.listen(HTTP_PORT, () => {
    console.log(`[sidecar] listo. Pruebe:
  curl -X POST http://localhost:${HTTP_PORT}/handshake \\
    -H 'Content-Type: application/json' \\
    -d '{"votanteId":101,"sesionToken":"fake-jwt"}'`);
});
