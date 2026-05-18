# Terminal de Votación — Sello Legítimo

SPA web para la **Terminal de Votación** (TV) de un puesto electoral. Forma parte del
sistema Sello Legítimo, sub-sistema **Sistema Electoral (SE)**.

Es la máquina física donde el votante marca su preferencia. Recibe sesiones autorizadas
por la **Terminal de Jurado** del mismo puesto y reporta los votos firmados al **Nodo de
Votación Activa**.

## Arquitectura

```
┌─────────────────────┐         ┌──────────────────────┐
│  Servidor Electoral │ ──▶ genera deployment.yml      │
└─────────────────────┘         │ + terminal-config.json│
                                └──────┬───────────────┘
                                       ↓ (distribución física)
                            ┌─────────────────────┐
                            │   Terminal Voto     │
                            │  (este SPA)         │
                            └──────┬──────────────┘
                                   │ POST /votar (Ed25519 firmado)
                                   ↓
                    ┌──────────────────────────────┐
                    │ Nodo de Votación Activa      │
                    └──────────────────────────────┘

                    ↑ POST /handshake (jurado autoriza sesión)
        ┌─────────────────────────┐
        │  Terminal Jurado del    │
        │  mismo puesto físico    │
        └─────────────────────────┘
```

## Stack

- Vite + React 18 + TypeScript
- Tailwind CSS 3
- `@noble/ed25519` para firma Ed25519 del voto
- `yaml` para parsear `deployment.yml`
- `axios` para llamadas HTTP

## Configuración

La terminal **no pide nada al arrancar**. Toda su configuración viene de dos archivos
que el Servidor Electoral genera antes de la jornada y que se distribuyen a la máquina
física:

### `public/deployment.yml`
Contiene toda la elección: candidatos, puntos, terminales (con su clave pública),
votantes asignados a cada terminal. Es el mismo archivo en todas las terminales del
puesto. Ver `public/deployment.yml` para el formato.

### `public/terminal-config.json`
Es **específico** de esta terminal (id, secreto JWT, clave privada Ed25519, URL del
Nodo y URL del Jurado). Cada máquina del puesto tiene el suyo distinto.

```json
{
    "id": 1,
    "secreto": "<jwt-bearer-de-esta-terminal>",
    "clavePrivada": "<ed25519-hex-o-base64>",
    "clusterUrl": "http://nodo-votacion.local:8080",
    "parentUrl": "http://terminal-jurado.local:8090"
}
```

> ⚠️ **Política de seguridad:** el `terminal-config.json` contiene secretos. NO se
> versiona en producción — el placeholder en este repo es solo para desarrollo. El
> operador del puesto lo coloca al momento del despliegue.

## Desarrollo local

### Opción A — SPA + sidecar end-to-end (recomendado)

```bash
npm install
npm run dev:all
```

Eso levanta dos procesos en paralelo:

- **Vite** en `http://localhost:5173` — el SPA del votante.
- **Sidecar** en `http://localhost:8090` (HTTP) + `ws://localhost:8091` (WebSocket).

El sidecar es un proceso Node + Express + ws que **simula el transporte HTTP
local** que en producción tendrá la Terminal de Jurado para empujar handshakes a
esta Terminal de Votación. El SPA se conecta automáticamente al WebSocket del
sidecar y recibe los handshakes en tiempo real.

#### Probar el flujo end-to-end

Con `npm run dev:all` corriendo, simula que el Jurado autoriza al votante 101:

```bash
curl -X POST http://localhost:8090/handshake \
  -H "Content-Type: application/json" \
  -d '{"votanteId":101,"sesionToken":"fake-jwt-dev"}'
```

El SPA en el navegador debe saltar inmediatamente de "Terminal en espera" a la
pantalla del tarjetón con el votante asignado a esta terminal.

### Opción B — Solo SPA (sin sidecar)

```bash
npm run dev
```

Inyecta un handshake vía query string:

```bash
node -e "console.log(encodeURIComponent(btoa(JSON.stringify({votanteId:101,sesionToken:'fake-jwt'}))))"
```

Abre `http://localhost:5173/?handshake=<resultado>`.

### Sobre el sidecar

`sidecar/handshakeSidecar.ts` es Node + Express + ws. Cumple el rol que en
producción tendría un launcher nativo (Electron, Tauri, o un binario empaquetado
junto al SPA). El contrato del sidecar hacia el SPA es estable:

- `POST http://localhost:8090/handshake` con `{ votanteId, sesionToken }`.
- `ws://localhost:8091` emite `{ tipo: "HANDSHAKE", votanteId, sesionToken }` a
  todos los SPA conectados.

Cualquier implementación de transporte que respete ese contrato es reemplazo
válido. La interfaz `subscribirseAHandshakes()` del SPA (`src/api/sidecarClient.ts`)
no necesita cambiar.

## Flujo en vivo

1. **Arranque** — carga deployment + config, valida que `terminal.activo=true` y
   `punto.activo=true`. Si alguno es `false` (el Servidor Electoral revocó la terminal),
   la pantalla queda en error y no permite votar.
2. **Espera** — pantalla "Terminal en espera. Acérquese al jurado".
3. **Handshake** — el Jurado autoriza una sesión enviando `{ votanteId, sesionToken }`.
4. **Tarjetón** — muestra candidatos del `deployment.yml`. Permite seleccionar uno
   o "Voto en Blanco".
5. **Confirmación** — pantalla obligatoria de revisión.
6. **Firma + envío** — `firmarVoto()` crea firma Ed25519 sobre
   `{terminal, votante, candidato}`, y se envía a `POST /votar` del Nodo con el bearer
   JWT de esta terminal.
7. **Comprobante** — muestra número de confirmación al votante y notifica al Jurado.
8. **Auto-reset** a los 30 s → vuelve a "espera".

## Atributos de calidad

- **Privacidad** — el voto se firma localmente; el JSON serializado del voto cifrado
  (cuando se integre VoteVault del compute-engine) viaja al Nodo.
- **Integridad** — RSA-... perdón, Ed25519. Solo la terminal con la clave privada puede
  emitir votos válidos para su `terminal.id`. El Nodo verifica con `terminal.clavePublica`
  del deployment.
- **No repudio** — la firma vincula el voto a la terminal específica.
- **Tolerancia a fraude** — el flag `activo` permite al Servidor Electoral revocar una
  terminal comprometida. La terminal lee `activo` al arrancar y se niega a operar si es
  `false`. (Para revocaciones en caliente: requiere mecanismo adicional, ver TODO.)
- **Trazabilidad** — cada voto registrado en el Nodo lleva `terminal`, `votante` y
  firma, suficiente para reconstruir auditoría sin exponer la preferencia.

## TODO

- [ ] **Endpoint local `POST /handshake`** — hoy se recibe vía query string para dev.
  El transporte real (HTTP local en el puesto) requiere un mini-servidor que corre
  junto al SPA (Electron, Tauri, o un sidecar Express). Decisión pendiente con el equipo.
- [ ] **Verificación del `sesionToken` JWT** — hoy aceptamos cualquier token no vacío.
  Cuando Augusto defina el formato del JWT del jurado, validar firma + expiración antes
  de mostrar tarjetón.
- [ ] **Detección de revocación en caliente** — polling al `/puesto` del Nodo cada N seg
  para refrescar `activo`. Hoy solo se valida al arrancar.
- [ ] **Voto Alternativo (ME-04 ranking)** — pendiente de integrar con SE-M3-06 que ya
  está en el frontend principal.
- [ ] **Integración con compute-engine / VoteVault** — hoy enviamos el voto en claro al
  Nodo. Cuando integremos cifrado del VoteVault del compute-engine, la terminal cifrará
  antes de enviar.

## Equipo

- Camilo Salinas (yo) — frontend
- Juan Eduardo — frontend
- Coordinación con: Augusto Pedicino (Servidor Electoral), Juan Martín (Nodo)
