import { useCallback, useEffect, useRef, useState } from "react";
import { X, Download, Loader2, Mail } from "lucide-react";
import {
  checkHealth,
  checkEmail,
  getComandasPendientes,
  descargarComandas,
  getColaEstado,
  limpiarPiezasListas,
  limpiarErrores,
  type ColaEstado,
  type PiezaResult,
} from "@/lib/api";
import { GrupoComanda } from "./GrupoComanda";
import { EntornProves } from "./EntornProves";
import { useUserConfig } from "@/hooks/use-user-config";

export function PaginaDescarga() {
  const { config } = useUserConfig();

  // --- Parte A: descarga manual ---
  const [comandas, setComandas] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverDown, setServerDown] = useState(false);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [emailMsg, setEmailMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const comandasRef = useRef<string[]>([]);
  comandasRef.current = comandas;

  const [piezasDescargadas, setPiezasDescargadas] = useState<PiezaResult[]>([]);
  const [erroresDescarga, setErroresDescarga] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    checkHealth().then((ok) => {
      if (active) setServerDown(!ok);
    });
    return () => {
      active = false;
    };
  }, []);

  const addCodes = useCallback((codes: string[]) => {
    const nuevos = codes.map((c) => c.trim()).filter((c) => c && !comandasRef.current.includes(c));
    const unicos = Array.from(new Set(nuevos));
    if (unicos.length) setComandas((c) => [...c, ...unicos]);
    return unicos;
  }, []);

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const { codigos } = await getComandasPendientes();
        const nuevos = addCodes(codigos ?? []);
        if (nuevos.length) setToast(`Nueva comanda detectada: ${nuevos[0]}`);
      } catch {
        /* silencio */
      }
    }, 300000);
    return () => clearInterval(id);
  }, [addCodes]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const detectarCorreo = async () => {
    setCheckingEmail(true);
    setEmailMsg(null);
    try {
      const { codigos } = await checkEmail();
      const nuevos = addCodes(codigos ?? []);
      setEmailMsg(
        nuevos.length
          ? { text: `${nuevos.length} comanda(s) detectadas`, ok: true }
          : { text: "Sin comandas nuevas en las últimas 24h", ok: false },
      );
    } catch (e) {
      setEmailMsg({
        text: e instanceof Error ? e.message : "Error al consultar el correo",
        ok: false,
      });
    } finally {
      setCheckingEmail(false);
    }
  };

  const commit = (raw: string) => {
    const value = raw.trim();
    if (!value || comandas.includes(value)) return;
    setComandas((c) => [...c, value]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit(draft);
      setDraft("");
    }
    if (e.key === "Backspace" && draft === "" && comandas.length) {
      setComandas((c) => c.slice(0, -1));
    }
  };

  const start = async () => {
    const list = draft.trim() ? [...comandas, draft.trim()] : comandas;
    if (draft.trim()) {
      setComandas(list);
      setDraft("");
    }
    if (!list.length) return;
    setError(null);
    setDownloading(true);
    try {
      const resultado = await descargarComandas(list);
      setPiezasDescargadas(resultado.piezas);
      setErroresDescarga(resultado.errores);
      setComandas([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido al descargar");
    } finally {
      setDownloading(false);
    }
  };

  // --- Parte B: monitor del proceso automático por correo ---
  const [estadoCola, setEstadoCola] = useState<ColaEstado | null>(null);
  const [sistemaActivo, setSistemaActivo] = useState(false);

  useEffect(() => {
    let cancelado = false;
    const poll = async () => {
      try {
        const data = await getColaEstado();
        if (cancelado) return;
        setEstadoCola(data);
        setSistemaActivo(true);
      } catch {
        if (!cancelado) setSistemaActivo(false);
      }
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => {
      cancelado = true;
      clearInterval(id);
    };
  }, []);

  const verPiezasAutomaticas = async () => {
    if (!estadoCola?.piezas_listas.length) return;
    setPiezasDescargadas(estadoCola.piezas_listas);
    setErroresDescarga([]);
    await limpiarPiezasListas();
    setEstadoCola((prev) =>
      prev ? { ...prev, piezas_listas: [], hay_nuevas: false, comandas_listas: [] } : prev,
    );
  };

  const descartarErroresCola = async () => {
    await limpiarErrores();
    setEstadoCola((prev) => (prev ? { ...prev, errores_recientes: [] } : prev));
  };

  // Piezas descargadas agrupadas por comanda, en el orden en que aparece
  // cada comanda por primera vez — tanto la descarga manual (varias comandas
  // de golpe) como la automática pueden traer piezas de más de una.
  const gruposPorComanda = piezasDescargadas.reduce<Map<string, PiezaResult[]>>((grupos, p) => {
    const lista = grupos.get(p.comanda);
    if (lista) lista.push(p);
    else grupos.set(p.comanda, [p]);
    return grupos;
  }, new Map());

  const procesando = estadoCola?.procesando ?? false;
  const cola = estadoCola?.cola ?? [];
  const hayNuevas = estadoCola?.hay_nuevas ?? false;
  const piezasListas = estadoCola?.piezas_listas ?? [];
  const erroresRecientes = estadoCola?.errores_recientes ?? [];

  return (
    <div className="mx-auto w-full max-w-6xl px-8 py-8">
      <h1 className="text-2xl font-semibold text-foreground">Descàrrega de comandes</h1>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr]">
        {/* Parte A — descarga manual */}
        <section className="card-elevated border border-border p-5">
          <div className="flex items-center gap-2">
            <Download className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Descàrrega manual</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Introdueix el número de comanda i prem Enter
          </p>

          {serverDown && (
            <div role="alert" className="mt-3 flex items-center gap-2 text-xs text-destructive">
              <span className="h-1 w-1 shrink-0 rounded-full bg-destructive" />
              Servidor no disponible
            </div>
          )}

          <input
            type="text"
            value={draft}
            disabled={downloading}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              commit(draft);
              setDraft("");
            }}
            placeholder="Número de comanda"
            aria-label="Número de comanda"
            className="mt-4 w-full rounded-lg border border-border bg-background px-3 py-2.5 font-mono text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-40"
          />

          {comandas.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {comandas.map((c) => (
                <li
                  key={c}
                  className="flex items-center gap-1.5 rounded-full border border-[#bfdbfe] bg-[var(--badge-info-bg)] px-3 py-1 font-mono text-xs text-primary"
                >
                  {c}
                  <button
                    type="button"
                    aria-label={`Eliminar comanda ${c}`}
                    disabled={downloading}
                    onClick={() => setComandas((list) => list.filter((x) => x !== c))}
                    className="text-primary/60 transition-colors hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {downloading ? (
            <div className="mt-4">
              <div className="flex items-center gap-2 text-sm text-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                Descargant comandes...
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full w-1/3 animate-indeterminate rounded-full bg-primary" />
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={start}
              disabled={!comandas.length && !draft.trim()}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-[#2952cc] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Download className="h-4 w-4" />
              Descarregar del portal
            </button>
          )}

          {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

          <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
            <button
              type="button"
              onClick={detectarCorreo}
              disabled={checkingEmail || downloading}
              className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              {checkingEmail ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Mail className="h-3 w-3" />
              )}
              Detectar del correu
            </button>
            {emailMsg && (
              <span
                className="text-xs"
                style={{ color: emailMsg.ok ? "var(--success)" : undefined }}
              >
                {emailMsg.text}
              </span>
            )}
          </div>
        </section>

        {/* Parte B — segundo plano automático (correo) */}
        <section className="card-elevated border border-border p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Monitorització automàtica</h2>
            {sistemaActivo && estadoCola?.deteccio_activa === false ? (
              <span className="flex items-center gap-1.5 text-xs text-[var(--badge-warning-text)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--badge-warning-text)]" />
                Pausat (Ajustos)
              </span>
            ) : (
              <span
                className={`flex items-center gap-1.5 text-xs ${sistemaActivo ? "text-[var(--badge-success-text)]" : "text-muted-foreground"}`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${sistemaActivo ? "animate-pulse bg-[var(--badge-success-text)]" : "bg-muted-foreground"}`}
                />
                {sistemaActivo ? "Sistema actiu" : "Sense connexió"}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Monitoritzant correu de Tavil</p>

          {erroresRecientes.length > 0 && (
            <div className="mt-3 border-l-2 border-destructive pl-3">
              <p className="text-xs text-destructive">{erroresRecientes.length} error(s) recents</p>
              <ul className="mt-1 max-h-24 space-y-0.5 overflow-y-auto">
                {erroresRecientes.map((e, i) => (
                  <li key={i} className="font-mono text-xs text-destructive/80">
                    {e}
                  </li>
                ))}
              </ul>
              <button
                onClick={descartarErroresCola}
                className="mt-1 text-xs text-destructive underline underline-offset-2"
              >
                Descartar
              </button>
            </div>
          )}

          {procesando && (
            <div className="mt-3 flex items-center gap-2 text-xs text-primary">
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              {estadoCola?.fase_actual || "Processant..."}
            </div>
          )}

          {cola.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {cola.length} comanda(es) en espera: {cola.join(", ")}
            </p>
          )}

          {hayNuevas && (
            <button
              type="button"
              onClick={verPiezasAutomaticas}
              className="group mt-3 flex items-center gap-1.5 text-sm font-medium text-primary transition-colors hover:text-[#2952cc]"
            >
              Veure {piezasListas.length} peça(es) descarregada(es)
              <span className="transition-transform group-hover:translate-x-1">→</span>
            </button>
          )}

          {!procesando && cola.length === 0 && !hayNuevas && erroresRecientes.length === 0 && (
            <p className="mt-3 text-xs text-muted-foreground">Sense activitat recent</p>
          )}
        </section>
      </div>

      {config.mostrarEntornProves && <EntornProves />}

      {/* Resultado de la última descarga (manual o automática) */}
      {piezasDescargadas.length > 0 && (
        <div className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              {piezasDescargadas.length} peça{piezasDescargadas.length === 1 ? "" : "s"}{" "}
              descarregada
              {piezasDescargadas.length === 1 ? "" : "s"}
            </p>
            <button
              onClick={() => {
                setPiezasDescargadas([]);
                setErroresDescarga([]);
              }}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Tancar
            </button>
          </div>
          {erroresDescarga.length > 0 && (
            <p className="mb-3 text-xs text-warning">
              {erroresDescarga.length} comanda(es) amb errors: {erroresDescarga.join(" · ")}
            </p>
          )}
          <div className="flex flex-col gap-4">
            {Array.from(gruposPorComanda.entries()).map(([comanda, piezas]) => (
              <GrupoComanda key={comanda} comanda={comanda} piezas={piezas} />
            ))}
          </div>
        </div>
      )}

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 rounded-xl border-l-4 border-primary bg-card px-4 py-3 text-sm text-foreground shadow-[var(--shadow-card-hover)]"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
