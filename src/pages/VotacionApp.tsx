import { useEffect, useMemo, useState } from "react";
import {
    AlertTriangle,
    CheckCircle2,
    ChevronRight,
    Loader2,
    ShieldCheck,
} from "lucide-react";
import { useContextoListo } from "../config/TerminalContext";
import { crearNodoClient, decodificarHandshakeDeQuery } from "../api/nodo.api";
import { firmarVoto } from "../crypto/firmaVoto";
import type { DeploymentCandidato, DeploymentVotante } from "../types/deployment";
import type { HandshakePayload, VotoPayload } from "../types/voto";

type Fase =
    | { kind: "esperando" }
    | { kind: "seleccion"; handshake: HandshakePayload; votante: DeploymentVotante }
    | {
          kind: "confirmacion";
          handshake: HandshakePayload;
          votante: DeploymentVotante;
          candidato: DeploymentCandidato | null; // null = voto en blanco
      }
    | {
          kind: "enviando";
          handshake: HandshakePayload;
          votante: DeploymentVotante;
          candidato: DeploymentCandidato | null;
      }
    | {
          kind: "comprobante";
          numero: string;
          candidato: DeploymentCandidato | null;
      }
    | { kind: "error"; mensaje: string };

const BLANCO_LABEL = "Voto en Blanco";

function numeroAprox() {
    const grupo = () =>
        Array.from({ length: 4 }, () =>
            "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".charAt(
                Math.floor(Math.random() * 32)
            )
        ).join("");
    return `VC-${new Date().getFullYear()}-${grupo()}-${grupo()}`;
}

export default function VotacionApp() {
    const { deployment, config, terminal } = useContextoListo();
    const [fase, setFase] = useState<Fase>({ kind: "esperando" });

    const nodo = useMemo(
        () =>
            crearNodoClient({
                clusterUrl: config.clusterUrl,
                secreto: config.secreto,
            }),
        [config]
    );

    // Capturamos handshake desde ?handshake=base64 al arrancar (modo dev).
    // En prod real el handshake llega vía un endpoint HTTP local que
    // empuja una nueva sesión; ese transporte se cablea cuando Augusto y
    // Juan Eduardo definan el detalle.
    useEffect(() => {
        if (fase.kind !== "esperando") return;
        const url = new URL(window.location.href);
        const h = decodificarHandshakeDeQuery(url.searchParams.get("handshake"));
        if (!h) return;

        const votante = terminal.votantes.find((v) => v.id === h.votanteId);
        if (!votante) {
            setFase({
                kind: "error",
                mensaje:
                    "El handshake hace referencia a un votante que no está asignado a esta terminal.",
            });
            return;
        }

        setFase({ kind: "seleccion", handshake: h, votante });
        // Limpiamos el query para evitar reusar el mismo handshake si recarga.
        url.searchParams.delete("handshake");
        window.history.replaceState({}, "", url.toString());
    }, [fase.kind, terminal.votantes]);

    if (fase.kind === "esperando") {
        return <PantallaEsperando />;
    }

    if (fase.kind === "error") {
        return (
            <PantallaError
                mensaje={fase.mensaje}
                onReintentar={() => setFase({ kind: "esperando" })}
            />
        );
    }

    if (fase.kind === "seleccion") {
        return (
            <PantallaSeleccion
                candidatos={deployment.candidatos}
                votante={fase.votante}
                onSeleccion={(candidato) =>
                    setFase({
                        kind: "confirmacion",
                        handshake: fase.handshake,
                        votante: fase.votante,
                        candidato,
                    })
                }
            />
        );
    }

    if (fase.kind === "confirmacion") {
        const handleConfirmar = async () => {
            setFase({
                kind: "enviando",
                handshake: fase.handshake,
                votante: fase.votante,
                candidato: fase.candidato,
            });

            try {
                const payload: VotoPayload = {
                    terminal: terminal.id,
                    votante: fase.votante.id,
                    candidato: fase.candidato?.id ?? 0, // 0 = blanco
                };
                const firma = await firmarVoto(payload, config.clavePrivada);
                await nodo.emitirVoto({ voto: payload, firma });

                // Notificar al jurado sin bloquear la UX si falla.
                nodo.notificarJurado(config.parentUrl, {
                    tipo: "VOTO_EMITIDO",
                    terminalId: terminal.id,
                    votanteId: fase.votante.id,
                }).catch(() => {
                    /* el jurado se entera por otra vía; no bloqueamos al votante */
                });

                setFase({
                    kind: "comprobante",
                    numero: numeroAprox(),
                    candidato: fase.candidato,
                });
            } catch (e) {
                setFase({
                    kind: "error",
                    mensaje:
                        e instanceof Error
                            ? `No se pudo registrar el voto: ${e.message}`
                            : "No se pudo registrar el voto.",
                });
            }
        };

        return (
            <PantallaConfirmacion
                candidato={fase.candidato}
                votante={fase.votante}
                onCancelar={() =>
                    setFase({
                        kind: "seleccion",
                        handshake: fase.handshake,
                        votante: fase.votante,
                    })
                }
                onConfirmar={handleConfirmar}
            />
        );
    }

    if (fase.kind === "enviando") {
        return <PantallaEnviando />;
    }

    if (fase.kind === "comprobante") {
        return (
            <PantallaComprobante
                numero={fase.numero}
                candidato={fase.candidato}
                onTerminar={() => setFase({ kind: "esperando" })}
            />
        );
    }

    return null;
}

// ─── Pantallas ──────────────────────────────────────────────────────────────

function PantallaEsperando() {
    return (
        <main className="min-h-screen flex flex-col items-center justify-center p-12 text-center bg-white">
            <div className="w-24 h-24 rounded-full bg-red-100 flex items-center justify-center mb-6">
                <ShieldCheck size={42} className="text-red-500" />
            </div>
            <h1 className="text-4xl font-extrabold text-gray-900">
                Terminal en espera
            </h1>
            <p className="text-lg text-gray-500 mt-3 max-w-md">
                Acérquese al jurado para identificar al votante. La terminal
                quedará habilitada en cuanto el jurado autorice la sesión.
            </p>
            <Loader2
                size={32}
                className="text-gray-400 animate-spin mt-10"
            />
        </main>
    );
}

function PantallaError({
    mensaje,
    onReintentar,
}: {
    mensaje: string;
    onReintentar: () => void;
}) {
    return (
        <main className="min-h-screen flex flex-col items-center justify-center p-12 text-center bg-white">
            <div className="w-24 h-24 rounded-full bg-red-100 flex items-center justify-center mb-6">
                <AlertTriangle size={42} className="text-red-600" />
            </div>
            <h1 className="text-3xl font-extrabold text-gray-900">
                Error en la sesión
            </h1>
            <p className="text-base text-gray-600 mt-3 max-w-xl">{mensaje}</p>
            <button
                onClick={onReintentar}
                className="mt-10 bg-red-500 hover:bg-red-600 text-white font-bold uppercase tracking-wide px-8 py-4 rounded-2xl"
            >
                Volver a esperar
            </button>
        </main>
    );
}

function PantallaSeleccion({
    candidatos,
    votante,
    onSeleccion,
}: {
    candidatos: DeploymentCandidato[];
    votante: DeploymentVotante;
    onSeleccion: (candidato: DeploymentCandidato | null) => void;
}) {
    const [marcado, setMarcado] = useState<number | "blank" | null>(null);

    return (
        <main className="min-h-screen flex flex-col bg-gray-50">
            <header className="bg-white border-b px-10 py-5">
                <h1 className="text-2xl font-extrabold text-gray-900">
                    Tarjetón electoral
                </h1>
                <p className="text-sm text-gray-500 mt-1">
                    Votante:{" "}
                    <strong className="text-gray-700">{votante.nombre}</strong>
                </p>
            </header>

            <section className="flex-1 px-10 py-8 overflow-y-auto">
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
                    {candidatos.map((c) => {
                        const sel = marcado === c.id;
                        return (
                            <button
                                key={c.id}
                                onClick={() => setMarcado(c.id)}
                                className={`relative text-left rounded-2xl border-4 p-5 transition ${
                                    sel
                                        ? "border-red-500 bg-red-50 shadow-lg"
                                        : "border-gray-200 bg-white hover:border-gray-400"
                                }`}
                            >
                                <div className="aspect-[4/5] bg-gray-100 rounded-xl mb-3 overflow-hidden">
                                    {c.fotoUrl ? (
                                        <img
                                            src={c.fotoUrl}
                                            alt={c.nombre}
                                            className="w-full h-full object-cover"
                                        />
                                    ) : null}
                                </div>
                                <p className="font-extrabold text-lg uppercase">
                                    {c.nombre}
                                </p>
                                <p className="text-sm text-red-500 font-bold uppercase">
                                    {c.partido}
                                </p>
                                {sel && (
                                    <span className="absolute top-3 right-3 bg-red-500 text-white text-xs font-extrabold px-3 py-1 rounded-full">
                                        SELECCIONADO
                                    </span>
                                )}
                            </button>
                        );
                    })}

                    <button
                        onClick={() => setMarcado("blank")}
                        className={`flex flex-col items-center justify-center rounded-2xl border-4 border-dashed p-8 min-h-[300px] transition ${
                            marcado === "blank"
                                ? "border-red-500 bg-red-50"
                                : "border-gray-300 bg-white hover:border-gray-400"
                        }`}
                    >
                        <p className="font-extrabold text-lg uppercase text-gray-800">
                            Voto en Blanco
                        </p>
                        <p className="text-sm text-gray-500 mt-2">
                            Si no desea votar por ningún candidato
                        </p>
                    </button>
                </div>
            </section>

            <footer className="bg-white border-t px-10 py-5 flex justify-end">
                <button
                    disabled={marcado === null}
                    onClick={() => {
                        if (marcado === "blank") onSeleccion(null);
                        else
                            onSeleccion(
                                candidatos.find((c) => c.id === marcado) ?? null
                            );
                    }}
                    className="flex items-center gap-3 bg-red-500 hover:bg-red-600 disabled:opacity-40 text-white font-extrabold uppercase tracking-wide px-10 py-5 rounded-2xl text-lg"
                >
                    Revisar mi voto
                    <ChevronRight size={22} />
                </button>
            </footer>
        </main>
    );
}

function PantallaConfirmacion({
    candidato,
    votante,
    onCancelar,
    onConfirmar,
}: {
    candidato: DeploymentCandidato | null;
    votante: DeploymentVotante;
    onCancelar: () => void;
    onConfirmar: () => void;
}) {
    return (
        <main className="min-h-screen flex flex-col items-center justify-center p-12 bg-white">
            <div className="max-w-2xl w-full bg-gray-50 rounded-3xl border p-10">
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                        <AlertTriangle size={22} className="text-red-500" />
                    </div>
                    <h1 className="text-3xl font-extrabold">
                        Confirme su voto
                    </h1>
                </div>

                <p className="text-gray-500 text-sm mb-1">
                    Votante:{" "}
                    <strong className="text-gray-700">{votante.nombre}</strong>
                </p>

                <div className="border-y py-6 my-6 text-center">
                    <p className="text-xs uppercase tracking-wider text-gray-400 font-semibold">
                        Su selección
                    </p>
                    <p className="text-4xl font-extrabold text-red-500 mt-2">
                        {candidato ? candidato.nombre : BLANCO_LABEL}
                    </p>
                    {candidato?.partido && (
                        <p className="text-sm text-gray-500 italic mt-1">
                            {candidato.partido}
                        </p>
                    )}
                </div>

                <p className="text-xs text-gray-500 mb-8 leading-relaxed">
                    Una vez confirmado, su voto se firma criptográficamente con
                    la llave de esta terminal y se envía al Nodo de Votación.
                    No podrá modificarse.
                </p>

                <div className="flex flex-col sm:flex-row gap-3 sm:justify-end">
                    <button
                        onClick={onCancelar}
                        className="border rounded-xl px-6 py-4 text-base font-semibold text-gray-700 hover:bg-gray-100"
                    >
                        Corregir mi voto
                    </button>
                    <button
                        onClick={onConfirmar}
                        className="flex items-center justify-center gap-2 bg-red-500 hover:bg-red-600 text-white font-bold uppercase tracking-wide px-8 py-4 rounded-xl text-base"
                    >
                        Confirmar y emitir voto
                    </button>
                </div>
            </div>
        </main>
    );
}

function PantallaEnviando() {
    return (
        <main className="min-h-screen flex flex-col items-center justify-center bg-white">
            <Loader2 size={48} className="text-red-500 animate-spin mb-6" />
            <h1 className="text-2xl font-extrabold text-gray-900">
                Firmando y enviando su voto…
            </h1>
            <p className="text-sm text-gray-500 mt-2">
                Por favor espere unos segundos.
            </p>
        </main>
    );
}

function PantallaComprobante({
    numero,
    candidato,
    onTerminar,
}: {
    numero: string;
    candidato: DeploymentCandidato | null;
    onTerminar: () => void;
}) {
    // Auto-cierre a los 30 s para liberar la terminal.
    useEffect(() => {
        const t = setTimeout(onTerminar, 30_000);
        return () => clearTimeout(t);
    }, [onTerminar]);

    return (
        <main className="min-h-screen flex flex-col items-center justify-center bg-white text-center px-10">
            <div className="w-24 h-24 rounded-full bg-green-100 flex items-center justify-center mb-6">
                <CheckCircle2 size={42} className="text-green-600" />
            </div>
            <h1 className="text-4xl font-extrabold text-gray-900">
                Voto registrado
            </h1>
            <p className="text-gray-500 mt-2 max-w-md">
                Su voto ha sido firmado y enviado al Nodo de Votación. Gracias
                por participar.
            </p>
            <div className="mt-8 bg-gray-50 border rounded-2xl px-8 py-5">
                <p className="text-xs uppercase tracking-wider text-gray-400 font-semibold">
                    Comprobante
                </p>
                <p className="text-3xl font-mono font-extrabold text-red-500 mt-2 tracking-widest">
                    {numero}
                </p>
                <p className="text-xs text-gray-500 mt-3">
                    Selección registrada:{" "}
                    <strong className="text-gray-700">
                        {candidato ? candidato.nombre : BLANCO_LABEL}
                    </strong>
                </p>
            </div>
            <button
                onClick={onTerminar}
                className="mt-10 bg-red-500 hover:bg-red-600 text-white font-bold uppercase tracking-wide px-10 py-4 rounded-2xl"
            >
                Finalizar
            </button>
        </main>
    );
}
