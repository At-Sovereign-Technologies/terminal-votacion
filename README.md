# Terminal de Votación — Sello Legítimo

SPA web para la **Terminal de Votación** (TV) de un puesto electoral, dentro
del sub-sistema **Sistema Electoral (SE)**.

Es la máquina donde el votante marca su voto. Es **cliente puro**: no escucha
puertos. Mantiene una conexión WebSocket persistente hacia la Terminal de
Jurado del mismo puesto y por ese canal recibe el handshake y envía el voto
firmado.

## Arquitectura

```
┌─────────────────────┐
│  Servidor Electoral │ ──▶ genera deployment.yml + terminal-config.json
└─────────────────────┘
                       ↓
                ┌─────────────────────┐
                │   Terminal Voto     │  (cliente WebSocket puro)
                │   (este SPA)        │
                └──────┬──────────────┘
                       │ WebSocket persistente
                       │  ← HANDSHAKE   (jurado autoriza)
                       │  → VOTO        (firmado Ed25519)
                       │  ← VOTO_ACEPTADO (con numeroConfirmacion)
                       ↓
            ┌──────────────────────────────┐
            │  Terminal Jurado             │
            │  (proxy al Nodo +            │
            │   cola offline)              │
            └──────────────┬───────────────┘
                           │ POST /votar (HTTP)
                           ↓
                ┌──────────────────────────────┐
                │ Nodo de Votación Activa      │
                │ (verifica firma + persiste)  │
                └──────────────────────────────┘
```

La Terminal Voto **nunca habla directo con el Nodo**. Todo va por el Jurado.
Eso le da al Jurado dos roles importantes:

- **Proxy controlado**: el Jurado puede verificar el `sesionToken` antes de
  reenviar el voto al Nodo.
- **Buffer offline**: si el Nodo está caído, el Jurado guarda el voto en
  cola local y reintenta. La Terminal Voto recibe un número de confirmación
  provisional y el votante puede irse tranquilo.

## Stack

- Vite + React 18 + TypeScript
- Tailwind CSS 3
- `@noble/ed25519` para firma Ed25519 del voto
- `yaml` para parsear `deployment.yml`
- Cliente WebSocket nativo del navegador (sin librería)

No tiene sidecar Node. Es solo el SPA en browser.

## Configuración

Dos archivos en `public/` generados por el Servidor Electoral antes de la
jornada.

### `public/deployment.yml`
Toda la elección: candidatos, puntos, terminales con su clave pública,
votantes asignados a cada terminal.

### `public/terminal-config.json`
Específico de esta terminal: id, JWT bearer, clave privada Ed25519 y URL
del Jurado.

```json
{
    "id": 1,
    "secreto": "<jwt-bearer-de-esta-terminal>",
    "clavePrivada": "<ed25519-hex-o-base64>",
    "parentUrl": "ws://terminal-jurado.local:8090"
}
```

El `parentUrl` debe apuntar al puerto **WS Voto** del sidecar del Jurado
(por defecto `:8090`), no a su HTTP. El cliente acepta también
`wss://host:port` o `ws://host:port`. El sidecar expone tres puertos
distintos: HTTP en `:8089` (consumido por el SPA del Jurado), WS de las
Terminales Voto en `:8090`, y WS del SPA del Jurado en `:8087`.

## Desarrollo local

```bash
npm install
npm run dev
```

Vite arranca en `http://localhost:5173`. La terminal intentará conectarse
al Jurado configurado en `terminal-config.json` (por defecto
`ws://localhost:8090`). Necesitas tener `terminal-jurado` corriendo en
paralelo para que el flujo funcione.

### Probar flujo end-to-end

Necesitas las dos terminales corriendo:

1. **terminal-jurado** (repo aparte): `npm run dev:all` → Vite 5180 + sidecar 8089.
2. **terminal-votacion** (este repo): `npm run dev` → Vite 5173.

Abre las dos en el navegador. En el Jurado, autoriza a un votante asignado
a tu terminal → la Voto cambia inmediatamente de "espera" a tarjetón.

## Flujo en vivo

1. **Arranque** — carga deployment + config, valida flags `activo`. Abre
   WebSocket persistente al Jurado.
2. **Espera** — pantalla "Terminal en espera". En el footer se muestra el
   estado de la conexión con el Jurado (conectando / abierto / cerrado).
3. **Handshake** — llega por el WebSocket con `{votanteId, sesionToken}`.
4. **Tarjetón** — muestra candidatos. Soporta:
   - Voto simple (un candidato o voto en blanco).
   - **Voto Alternativo ME-04**: toggle activa ranking; tocar candidatos
     en orden les asigna preferencia 1°, 2°, 3°, etc.
5. **Confirmación** — pantalla obligatoria de revisión.
6. **Firma + envío** — `firmarVoto()` crea firma Ed25519 con serialización
   canónica. El SPA envía `{tipo: "VOTO", payload: {voto, firma}}` por el
   WebSocket al Jurado.
7. **Respuesta** — el Jurado responde `VOTO_ACEPTADO` con número de
   confirmación, o `VOTO_RECHAZADO` con motivo.
8. **Comprobante** — muestra el número de confirmación. **Auto-reset a los
   30 s** → vuelve a "espera".

## Reconexión automática

Si el WebSocket cae (red intermitente, reinicio del Jurado), el cliente
reintenta cada 2 segundos. Mientras está cerrado, la terminal **no acepta
votos**: si el votante intenta confirmar, recibe "No hay conexión con el
Jurado, espere".

## Atributos de calidad

- **Privacidad** — la clave privada Ed25519 nunca sale del cliente; solo
  se publica la clave pública en el `deployment.yml`.
- **Integridad** — firma Ed25519 sobre serialización canónica de
  `{terminal, votante, candidato, preferencias?}`. El Nodo verifica con la
  `clavePublica`. Cualquier alteración del voto invalida la firma.
- **No repudio** — la firma vincula el voto a la terminal que lo generó.
- **Control de fraude** — flag `activo` chequeado al arrancar. El Jurado
  puede rechazar votos de terminales que considera comprometidas.
- **Resiliencia** — reconexión automática del WebSocket. El votante no
  puede emitir si no hay conexión con el Jurado, pero la conexión se
  recupera sola en cuanto el Jurado vuelva.

## Pruebas

```bash
npm test
```

Vitest corre los tests en `src/crypto/firmaVoto.test.ts`:

- Firma y verifica un voto simple (round-trip con par Ed25519 conocido).
- Rechaza la firma si se altera el candidato.
- La serialización canónica del ranking es determinística e independiente
  del orden de inserción en `preferencias`.
- Alterar el ranking invalida la firma.
- Voto en blanco (`candidato=0` sin preferencias) firma y verifica.

## Pendientes

- **Verificación del `sesionToken` JWT.** Hoy el SPA acepta cualquier
  token no vacío. Cuando el formato del JWT del jurado quede definido, se
  valida firma + expiración antes de mostrar tarjetón.
- **Pruebas del cliente WebSocket.** Falta cobertura con mock server
  (reconexión automática, timeout de espera de respuesta del Jurado).
