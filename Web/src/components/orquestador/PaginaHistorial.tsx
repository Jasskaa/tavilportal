import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Trash2, ChevronDown, Check, Copy, TriangleAlert } from "lucide-react";
import {
  getHistorial,
  marcarPiezaOk,
  limpiarHistorialOk,
  enriquirHistorial,
  type PiezaHistorial,
} from "@/lib/api";
import { copiarAlPortaretes, calcularEstatPeca, ETIQUETA_ESTAT_PECA } from "@/lib/utils";

const INTERVAL_ENRIQUIMENT_MS = 5 * 60 * 1000; // 5 minuts

function formatarData(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("ca-ES", { day: "2-digit", month: "2-digit", year: "2-digit" });
  } catch {
    return iso;
  }
}

interface CampCopiableProps {
  label: string;
  value: string;
}

function CampCopiable({ label, value }: CampCopiableProps) {
  const [copiat, setCopiat] = useState(false);

  const copiar = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await copiarAlPortaretes(value);
    if (ok) {
      setCopiat(true);
      setTimeout(() => setCopiat(false), 1500);
    }
  };

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2">
      <div className="min-w-0">
        <span className="text-[10px] font-medium uppercase tracking-[0.05em] text-muted-foreground">
          {label}
        </span>
        <p className="truncate text-sm text-foreground">{value || "—"}</p>
      </div>
      <button
        type="button"
        onClick={copiar}
        disabled={!value}
        title={`Copiar ${label.toLowerCase()}`}
        aria-label={`Copiar ${label.toLowerCase()}`}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-primary disabled:cursor-not-allowed disabled:opacity-30"
      >
        {copiat ? <Check className="h-3.5 w-3.5 text-[var(--badge-success-text)]" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

interface FilaProps {
  pieza: PiezaHistorial;
  onToggle: (pieza: PiezaHistorial) => void;
  completada: boolean;
}

function FilaHistorial({ pieza, onToggle, completada }: FilaProps) {
  const [detallObert, setDetallObert] = useState(false);
  const codigo = pieza.ref || pieza.file;
  const estat = calcularEstatPeca(pieza);

  return (
    <li
      className={`rounded-xl border border-border bg-card transition-opacity ${completada ? "opacity-60" : ""}`}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => onToggle(pieza)}
          title={completada ? "Marcar com a pendent" : "Marcar com a completada"}
          aria-label={completada ? "Marcar com a pendent" : "Marcar com a completada"}
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
            completada
              ? "border-primary bg-primary text-primary-foreground"
              : "border-muted-foreground/40 hover:border-primary"
          }`}
        >
          {completada && <Check className="h-3 w-3" />}
        </button>

        <button
          type="button"
          onClick={() => setDetallObert((v) => !v)}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex items-center gap-2">
            <span
              className={`font-mono text-sm font-medium text-foreground ${completada ? "line-through" : ""}`}
            >
              {codigo || "—"}
            </span>
            <span className="badge-pill bg-[var(--badge-neutral-bg)] text-[var(--badge-neutral-text)]">
              {pieza.comanda}
            </span>
            <span
              className={`badge-pill ${
                estat === "versio_nova"
                  ? "bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)]"
                  : estat === "nova"
                    ? "bg-[var(--badge-info-bg)] text-[var(--badge-info-text)]"
                    : "bg-[var(--badge-neutral-bg)] text-[var(--badge-neutral-text)]"
              }`}
            >
              {estat === "versio_nova" && <TriangleAlert className="h-3 w-3" />}
              {ETIQUETA_ESTAT_PECA[estat]}
            </span>
            {!pieza.tiene_excel && (
              <span className="badge-pill bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)]">
                Sense Excel encara
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{pieza.desc || pieza.file}</p>
        </button>

        <span className="shrink-0 text-xs text-muted-foreground">{formatarData(pieza.fecha)}</span>
        <ChevronDown
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform"
          style={{ transform: detallObert ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </div>

      {detallObert && (
        <div className="grid grid-cols-1 gap-2 border-t border-border px-4 py-3 sm:grid-cols-2">
          <CampCopiable label="Descripció" value={pieza.desc} />
          <CampCopiable label="Ref. client" value={pieza.refCliente} />
          <CampCopiable label="Tractament" value={pieza.tract} />
          <CampCopiable label="Gruix" value={pieza.grosor} />
        </div>
      )}
    </li>
  );
}

export function PaginaHistorial() {
  const [piezas, setPiezas] = useState<PiezaHistorial[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completadesObertes, setCompletadesObertes] = useState(false);

  const recargar = useCallback(() => {
    setCargando(true);
    setError(null);
    getHistorial()
      .then(({ piezas }) => setPiezas(piezas))
      .catch((e) => setError(e instanceof Error ? e.message : "Error carregant l'historial"))
      .finally(() => setCargando(false));
  }, []);

  /** Botó "Actualitzar": primer torna a buscar Excels per a les peces que
   * encara no en tenien (algú pot haver-lo creat des de l'última vegada) i
   * després recarrega la llista — així es veu de seguida si s'ha omplert
   * alguna cosa nova. */
  const actualitzar = useCallback(async () => {
    try {
      await enriquirHistorial();
    } catch {
      /* silencio — es recarrega igualment amb el que ja hi hagi */
    }
    recargar();
  }, [recargar]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  // El servidor ja cerca Excels nous sol cada 5 minuts en segon pla
  // (encara que ningú tingui aquesta pàgina oberta) — aquest interval només
  // fa que, si la tens oberta, es vegi reflectit sense haver de prémer res.
  useEffect(() => {
    const id = setInterval(recargar, INTERVAL_ENRIQUIMENT_MS);
    return () => clearInterval(id);
  }, [recargar]);

  const toggle = async (pieza: PiezaHistorial) => {
    const nouEstat = pieza.estado === "ok" ? "pendiente" : "ok";
    setPiezas((prev) => prev.map((p) => (p.id === pieza.id ? { ...p, estado: nouEstat } : p)));
    await marcarPiezaOk(pieza.id, nouEstat);
  };

  const netejarOk = async () => {
    await limpiarHistorialOk();
    setPiezas((prev) => prev.filter((p) => p.estado !== "ok"));
  };

  const pendents = piezas.filter((p) => p.estado !== "ok");
  const completades = piezas.filter((p) => p.estado === "ok");

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-8 sm:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">Historial de peces</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={actualitzar}
            disabled={cargando}
            title="Torna a buscar Excels nous i recarrega la llista"
            className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-accent disabled:cursor-wait disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${cargando ? "animate-spin" : ""}`} />
            Actualitzar
          </button>
          <button
            type="button"
            onClick={netejarOk}
            disabled={!completades.length}
            className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Netejar OK
          </button>
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      {cargando && !piezas.length ? (
        <p className="mt-16 text-center text-sm text-muted-foreground">Carregant...</p>
      ) : (
        <>
          <section className="mt-6">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium text-foreground">Pendents</h2>
              <span className="badge-pill bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)]">
                {pendents.length}
              </span>
            </div>
            {pendents.length === 0 ? (
              <p className="mt-4 py-8 text-center text-sm text-muted-foreground">
                No hi ha peces pendents
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {pendents.map((p) => (
                  <FilaHistorial key={p.id} pieza={p} onToggle={toggle} completada={false} />
                ))}
              </ul>
            )}
          </section>

          <section className="mt-8">
            <button
              type="button"
              onClick={() => setCompletadesObertes((v) => !v)}
              className="flex items-center gap-2"
            >
              <h2 className="text-sm font-medium text-foreground">Completades</h2>
              <span className="badge-pill bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]">
                {completades.length}
              </span>
              <ChevronDown
                className="h-3.5 w-3.5 text-muted-foreground transition-transform"
                style={{ transform: completadesObertes ? "rotate(180deg)" : "rotate(0deg)" }}
              />
            </button>
            {completadesObertes && (
              <ul className="mt-3 flex flex-col gap-2">
                {completades.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No hi ha peces completades
                  </p>
                ) : (
                  completades.map((p) => (
                    <FilaHistorial key={p.id} pieza={p} onToggle={toggle} completada={true} />
                  ))
                )}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
