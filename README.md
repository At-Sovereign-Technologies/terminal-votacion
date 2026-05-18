# Terminal de Votación — Sello Legítimo

SPA web para la **Terminal de Votación** (TV) de un puesto electoral, dentro
del sub-sistema **Sistema Electoral (SE)**.

Es la máquina donde el votante marca su voto. Recibe sesiones autorizadas
por la Terminal de Jurado del mismo puesto y reporta los votos firmados al
Nodo de Votación Activa.

## Arquitectura

```
┌─────────────────────┐
│  Servidor Electoral │ ──▶ genera deployment.yml + terminal-config.json
└─────────────────────┘
                       ↓
                ┌─────────────────────┐
                │   Terminal Voto     │
                │   (este SPA)        │
                └──────┬──────────────┘
                       │ POST /votar (Ed25519 firmado)
                       │ GET  /puesto (polling revocación)
                       ↓
            ┌──────────────────────────────┐
            │ Nodo de Votación Activa      │
            └──────────────────────────────┘

            ↑ POST /handshake (jurado autoriza sesión)
        ┌─────────────────────────┐
        │  Terminal Jurado        │
        │  del mismo puesto       │
        └─────────────────────────┘
```

## Stack

- Vite + React 18 + TypeScript
- Tailwind CSS 3
- `@noble/ed25519` para firma Ed25519 del voto
- `yaml` para parsear `deployment.yml`
- `axios` para HTTP al Nodo
- Sidecar: Node + Express + ws + tsx

## Configuración

La terminal no pide nada al arrancar. Toda su configuración viene de dos
archivos en `public/` que el Servidor Electoral genera antes de la jornada:

### `public/deployment.yml`
Toda la elección: candidatos, puntos, terminales con su clave pública,
votantes asignados a cada terminal. Mismo archivo en todas las terminales del
puesto.

### `public/terminal-config.json`
Específico de esta terminal: id, JWT bearer, clave privada Ed25519, URL del
Nodo y URL del Jurado.

```json
{
    "id": 1,
    "secreto": "<jwt-bearer-de-esta-terminal>",
    "clavePrivada": "<ed25519-hex-o-base64>",
    "clusterUrl": "http://nodo-votacion.local:8080",
    "parentUrl": "http://terminal-jurado.local:8089"
}
```

## Desarrollo local

### Opción A — SPA + sidecar (recomendado)

```bash
npm install
npm run dev:all
```

- **Vite** en `http://localhost:5173` — SPA del votante.
- **Sidecar** en `http://localhost:8090` (HTTP) + `ws://localhost:8091` (WS).

El sidecar simula el transporte HTTP local que en producción tendrá la
Terminal de Jurado para empujar handshakes. El SPA escucha el WebSocket y
recibe los handshakes en tiempo real.

#### Probar el flujo end-to-end

```bash
curl -X POST http://localhost:8090/handshake \
  -H "Content-Type: application/json" \
  -d '{"votanteId":101,"sesionToken":"fake-jwt-dev"}'
```

El SPA salta inmediatamente de "Terminal en espera" a la pantalla del
tarjetón.

### Opción B — Solo SPA (sin sidecar)

```bash
npm run dev
```

Inyecta un handshake vía query string:

```bash
node -e "console.log(encodeURIComponent(btoa(JSON.stringify({votanteId:101,sesionToken:'fake-jwt'}))))"
```

Y abre `http://localhost:5173/?handshake=<resultado>`.

### Sobre el sidecar

`sidecar/handshakeSidecar.ts` es Node + Express + ws. Cumple el rol que en
producción tendría un launcher nativo (Electron, Tauri o un binario
empaquetado junto al SPA). Su contrato hacia el SPA es estable:

- `POST http://localhost:8090/handshake` con `{ votanteId, sesionToken }`.
- `ws://localhost:8091` emite `{ tipo: "HANDSHAKE", votanteId, sesionToken }`.

Cualquier implementación de transporte que respete ese contrato es reemplazo
válido. La interfaz `subscribirseAHandshakes()` del SPA no necesita cambiar.

## Flujo en vivo

1. **Arranque** — carga deployment + config, valida `terminal.activo` y
   `punto.activo`. Si alguno es `false`, la terminal queda bloqueada.
2. **Espera** — pantalla "Terminal en espera".
3. **Handshake** — el Jurado autoriza una sesión enviando
   `{ votanteId, sesionToken }`.
4. **Tarjetón** — muestra candidatos del `deployment.yml`. Soporta:
   - Voto simple (un candidato o voto en blanco).
   - **Voto Alternativo ME-04**: toggle activa modo ranking; tocar
     candidatos en orden les asigna preferencia 1°, 2°, 3°, etc. Re-tocar
     quita la marca y reajusta numeración. Por construcción nunca hay
     valores repetidos.
5. **Confirmación** — pantalla obligatoria de revisión.
6. **Firma + envío** — `firmarVoto()` crea firma Ed25519 con serialización
   canónica y se envía a `POST /votar`.
7. **Comprobante** — número de confirmación al votante y notificación al
   Jurado vía `parent_url`.
8. **Auto-reset** a los 30 s → vuelve a "espera".

## Revocación en caliente

Cada 30 segundos el SPA llama a `GET /puesto` del Nodo. Si el Servidor
Electoral marcó esta terminal o este punto como inactivos durante la
jornada (por compromiso de seguridad, evidencia de fraude, etc.), la
terminal pasa a pantalla bloqueada sin necesidad de reinicio.

Caídas temporales del Nodo (timeout, 503) no disparan revocación: solo se
loguean. La revocación requiere respuesta 200 explícita con `activo: false`.

## Atributos de calidad

- **Privacidad** — el voto se firma localmente; el SPA solo envía firma +
  payload del voto al Nodo, nunca expone la clave privada.
- **Integridad** — firma Ed25519 sobre serialización canónica de
  `{terminal, votante, candidato, preferencias?}`. El Nodo verifica con la
  `clavePublica` del deployment. Cualquier alteración invalida la firma.
- **No repudio** — la firma vincula el voto a la terminal específica que la
  generó.
- **Control de fraude** — flag `activo` chequeado al arrancar y refrescado
  por polling cada 30s. Una terminal revocada deja de aceptar sesiones.
- **Trazabilidad** — cada voto registrado en el Nodo lleva `terminal`,
  `votante` y firma, suficiente para auditoría posterior.

## Pendientes

- **Endpoint local `POST /handshake` empaquetado.** Hoy es un sidecar Node
  en dev. Para producción se decide entre Electron, Tauri o un launcher
  nativo. Decisión pendiente del equipo.
- **Verificación del `sesionToken` JWT.** Hoy se acepta cualquier token no
  vacío. Cuando el formato del JWT del jurado quede definido, validar firma
  + expiración antes de mostrar tarjetón.
- **Integración con VoteVault del compute-engine.** Hoy el voto viaja en
  claro al Nodo (es éste quien custodia). Si se decide cifrado adicional
  con el VoteVault, la terminal cifrará antes de enviar.
- **Pruebas unitarias.** Sin tests todavía. Pendiente cobertura de:
  - firma Ed25519 (round-trip con keys conocidas).
  - serialización canónica (ranking ordenado independiente del insert order).
  - sidecar (curl + recepción WebSocket).
  - hook de polling con timers fake.
