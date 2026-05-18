import { useEffect, useMemo, useState } from "react";
import {
    AlertTriangle,
    CheckCircle2,
    ChevronRight,
    ListOrdered,
    Loader2,
    RotateCcw,
    ShieldCheck,
} from "lucide-react";
import { useContextoListo } from "../config/TerminalContext";
import { crearNodoClient, decodificarHandshakeDeQuery } from "../api/nodo.api";
import { subscribirseAHandshakes } from "../api/sidecarClient";
import { firmarVoto } from "../crypto/firmaVoto";
import type { DeploymentCandidato, DeploymentVotante } from "../types/deployment";
import type { HandshakePayload, VotoPayload } from "../types/voto";

// Una selección puede ser candidato único, voto en blanco, o ranking alternativo.
type Seleccion =
    | { tipo: "candidato"; candidato: DeploymentCandidato }
    | { tipo: "blanco" }
    | { tipo: "ranking"; ranking: Record<string, number> };

type Fase =
    | { kind: "esperando" }
    | { kind: "seleccion"; handshake: HandshakePayload; votante: DeploymentVotante }
    | {
          kind: "confirmacion";
          handshake: HandshakePayload;
          votante: DeploymentVotante;
          seleccion: Seleccion;
      }
    | {
          kind: "enviando";
          handshake: HandshakePayload;
          votante: DeploymentVotante;
          seleccion: Seleccion;
      }
    | {
          kind: "comprobante";
          numero: string;
          seleccion: Seleccion;
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

function labelSeleccion(s: Seleccion, candidatos: DeploymentCandidato[]): string {
    if (s.tipo === "blanco") return BLANCO_LABEL;
    if (s.tipo === "candidato") return s.candidato.nombre;
    const orden = Object.entries(s.ranking).sort((a, b) => a[1] - b[1]);
    return orden
        .map(([id, n]) => {
            const c = candidatos.find((x) => String(x.id) === id);
            return `${n}° ${c?.nombre ?? id}`;
        })
        .join(" · ");
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

    const procesarHandshake = (h: HandshakePayload) => {
        if (fase.kind !== "esperando") return;
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
    };

    useEffect(() => {
        if (fase.kind !== "esperando") return;
        const url = new URL(window.location.href);
        const h = decodificarHandshakeDeQuery(url.searchParams.get("handshake"));
        if (!h) return;
        procesarHandshake(h);
        url.searchParams.delete("handshake");
        window.history.replaceState({}, "", url.toString());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fase.kind, terminal.votantes]);

    useEffect(() => {
        const sub = subscribirseAHandshakes((h) => procesarHandshake(h));
        return () => sub.cerrar();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fase.kind, terminal.votantes]);

    if (fase.kind === "esperando") return <PantallaEsperando />;
    if (fase.kind === "error")
        return (
            <PantallaError
                mensaje={fase.mensaje}
                onReintentar={() => setFase({ kind: "esperando" })}
            />
        );

    if (fase.kind === "seleccion") {
        return (
            <PantallaSeleccion
                candidatos={deployment.candidatos}
                votante={fase.votante}
                onSeleccion={(seleccion) =>
                    setFase({
                        kind: "confirmacion",
                        handshake: fase.handshake,
                        votante: fase.votante,
                        seleccion,
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
                seleccion: fase.seleccion,
            });
            try {
                const payload: VotoPayload = construirPayload(
                    terminal.id,
                    fase.votante.id,
                    fase.seleccion
                );
                const firma = await firmarVoto(payload, config.clavePrivada);
                await nodo.emitirVoto({ voto: payload, firma });
                nodo.notificarJurado(config.parentUrl, {
                    tipo: "VOTO_EMITIDO",
                    terminalId: terminal.id,
                    votanteId: fase.votante.id,
                }).catch(() => {
                    /* no bloqueamos al votante */
                });
                setFase({
                    kind: "comprobante",
                    numero: numeroAprox(),
                    seleccion: fase.seleccion,
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
                seleccion={fase.seleccion}
                votante={fase.votante}
                candidatos={deployment.candidatos}
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

    if (fase.kind === "enviando") return <PantallaEnviando />;

    if (fase.kind === "comprobante") {
        return (
            <PantallaComprobante
                numero={fase.numero}
                seleccion={fase.seleccion}
                candidatos={deployment.candidatos}
                onTerminar={() => setFase({ kind: "esperando" })}
            />
        );
    }

    return null;
}

// Construye el VotoPayload que se firma y envía al Nodo.
function construirPayload(
    terminalId: number,
    votanteId: number,
    s: Seleccion
): VotoPayload {
    if (s.tipo === "candidato") {
        return { terminal: terminalId, votante: votanteId, candidato: s.candidato.id };
    }
    if (s.tipo === "blanco") {
        return { terminal: terminalId, votante: votanteId, candidato: 0 };
    }
    return {
        terminal: terminalId,
        votante: votanteId,
        candidato: 0,
        preferencias: s.ranking,
    };
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
            <Loader2 size={32} className="text-gray-400 animate-spin mt-10" />
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
    onSeleccion: (s: Seleccion) => void;
}) {
    // Modo simple: un candidato O voto en blanco.
    const [marcado, setMarcado] = useState<number | "blank" | null>(null);
    // Modo alternativo (ME-04): mapa candidatoId -> preferencia (1..N).
    const [modoAlternativo, setModoAlternativo] = useState(false);
    const [ranking, setRanking] = useState<Record<string, number>>({});

    const candidatosRankeados = Object.keys(ranking).length;

    const toggleRanking = (candidatoId: string) => {
        setRanking((prev) => {
            if (prev[candidatoId]) {
                // Quitar y reajustar numeración.
                const eliminado = prev[candidatoId];
                const nuevo: Record<string, number> = {};
                for (const [k, v] of Object.entries(prev)) {
                    if (k === candidatoId) continue;
                    nuevo[k] = v > eliminado ? v - 1 : v;
                }
                return nuevo;
            }
            return { ...prev, [candidatoId]: Object.keys(prev).length + 1 };
        });
    };

    const cambiarModo = (alternativo: boolean) => {
        setModoAlternativo(alternativo);
        setMarcado(null);
        setRanking({});
    };

    const handleRevisar = () => {
        if (modoAlternativo) {
            if (candidatosRankeados === 0) return;
            onSeleccion({ tipo: "ranking", ranking });
            return;
        }
        if (marcado === "blank") {
            onSeleccion({ tipo: "blanco" });
            return;
        }
        if (typeof marcado === "number") {
            const c = candidatos.find((x) => x.id === marcado);
            if (c) onSeleccion({ tipo: "candidato", candidato: c });
        }
    };

    const puedeAvanzar = modoAlternativo
        ? candidatosRankeados > 0
        : marcado !== null;

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

            <section className="flex-1 px-10 py-6 overflow-y-auto">
                <div className="max-w-6xl mx-auto">
                    <div className="bg-white border rounded-2xl px-5 py-4 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div className="flex items-start gap-3">
                            <div className="w-9 h-9 rounded-full bg-red-50 flex items-center justify-center shrink-0">
                                <ListOrdered size={16} className="text-red-500" />
                            </div>
                            <div>
                                <p className="font-bold text-sm">
                                    {modoAlternativo
                                        ? "Voto Alternativo activo (ME-04)"
                                        : "Voto único"}
                                </p>
                                <p className="text-xs text-gray-500">
                                    {modoAlternativo
                                        ? "Toque candidatos en orden de preferencia (1°, 2°, 3°…). Re-tocar quita la marca."
                                        : "Seleccione un único candidato o el voto en blanco."}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            {modoAlternativo && candidatosRankeados > 0 && (
                                <button
                                    onClick={() => setRanking({})}
                                    className="flex items-center gap-1 border rounded-lg px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                                >
                                    <RotateCcw size={12} /> Limpiar
                                </button>
                            )}
                            <button
                                onClick={() => cambiarModo(!modoAlternativo)}
                                className={`text-xs font-bold uppercase tracking-wide px-4 py-2 rounded-lg ${
                                    modoAlternativo
                                        ? "bg-gray-800 text-white hover:bg-gray-900"
                                        : "bg-red-500 text-white hover:bg-red-600"
                                }`}
                            >
                                {modoAlternativo
                                    ? "Volver a voto único"
                                    : "Activar voto alternativo"}
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-6">
                        {candidatos.map((c) => {
                            const rank = modoAlternativo
                                ? ranking[String(c.id)]
                                : undefined;
                            const sel = modoAlternativo
                                ? !!rank
                                : marcado === c.id;
                            return (
                                <button
                                    key={c.id}
                                    onClick={() =>
                                        modoAlternativo
                                            ? toggleRanking(String(c.id))
                                            : setMarcado(c.id)
                                    }
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
                                        <span className="absolute top-3 right-3 bg-red-500 text-white text-sm font-extrabold w-9 h-9 rounded-full flex items-center justify-center">
                                            {rank ?? "✓"}
                                        </span>
                                    )}
                                </button>
                            );
                        })}

                        {!modoAlternativo && (
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
                        )}
                    </div>
                </div>
            </section>

            <footer className="bg-white border-t px-10 py-5 flex justify-between items-center">
                <p className="text-xs text-gray-500">
                    {modoAlternativo
                        ? `Preferencias asignadas: ${candidatosRankeados} de ${candidatos.length}`
                        : marcado !== null
                          ? "Selección lista para revisar"
                          : "Seleccione una opción para continuar"}
                </p>
                <button
                    disabled={!puedeAvanzar}
                    onClick={handleRevisar}
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
    seleccion,
    votante,
    candidatos,
    onCancelar,
    onConfirmar,
}: {
    seleccion: Seleccion;
    votante: DeploymentVotante;
    candidatos: DeploymentCandidato[];
    onCancelar: () => void;
    onConfirmar: () => void;
}) {
    const esRanking = seleccion.tipo === "ranking";
    const resumen =
        seleccion.tipo === "candidato"
            ? seleccion.candidato.nombre
            : seleccion.tipo === "blanco"
              ? BLANCO_LABEL
              : null;

    return (
        <main className="min-h-screen flex flex-col items-center justify-center p-12 bg-white">
            <div className="max-w-2xl w-full bg-gray-50 rounded-3xl border p-10">
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                        <AlertTriangle size={22} className="text-red-500" />
                    </div>
                    <h1 className="text-3xl font-extrabold">Confirme su voto</h1>
                </div>

                <p className="text-gray-500 text-sm mb-1">
                    Votante:{" "}
                    <strong className="text-gray-700">{votante.nombre}</strong>
                </p>

                {esRanking && (
                    <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 mt-3 mb-3 text-xs text-blue-700 font-semibold inline-flex items-center gap-2">
                        <ListOrdered size={14} /> Voto Alternativo (ME-04)
                    </div>
                )}

                <div className="border-y py-6 my-6 text-center">
                    <p className="text-xs uppercase tracking-wider text-gray-400 font-semibold">
                        Su selección
                    </p>
                    {resumen && (
                        <p className="text-4xl font-extrabold text-red-500 mt-2">
                            {resumen}
                        </p>
                    )}
                    {seleccion.tipo === "candidato" &&
                        seleccion.candidato.partido && (
                            <p className="text-sm text-gray-500 italic mt-1">
                                {seleccion.candidato.partido}
                            </p>
                        )}
                    {seleccion.tipo === "ranking" && (
                        <ol className="mt-3 space-y-2 inline-block text-left">
                            {Object.entries(seleccion.ranking)
                                .sort((a, b) => a[1] - b[1])
                                .map(([id, n]) => {
                                    const c = candidatos.find(
                                        (x) => String(x.id) === id
                                    );
                                    return (
                                        <li
                                            key={id}
                                            className="flex items-center gap-3 text-base"
                                        >
                                            <span className="w-7 h-7 rounded-full bg-red-500 text-white text-xs font-extrabold flex items-center justify-center">
                                                {n}
                                            </span>
                                            <span className="font-semibold text-gray-900">
                                                {c?.nombre ?? id}
                                            </span>
                                        </li>
                                    );
                                })}
                        </ol>
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
    seleccion,
    candidatos,
    onTerminar,
}: {
    numero: string;
    seleccion: Seleccion;
    candidatos: DeploymentCandidato[];
    onTerminar: () => void;
}) {
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
                <p className="text-xs text-gray-500 mt-3 max-w-md">
                    Selección registrada:{" "}
                    <strong className="text-gray-700">
                        {labelSeleccion(seleccion, candidatos)}
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
