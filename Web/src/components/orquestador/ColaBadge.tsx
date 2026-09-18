import { useEffect, useRef, useState } from "react";
import { Inbox } from "lucide-react";
import { getColaEstado, type ColaEstado } from "@/lib/api";

interface Props {
  /** Canvia a la secció "Descàrrega", on ja hi ha el botó real per veure
   * les peces llestes (evita duplicar aquí la lògica de PaginaDescarga). */
  onVerPeces: () => void;
}

/** Indicador de l'estat de la cua de correu automàtic a la barra superior —
 * fa polling lleuger del mateix endpoint que ja consulta PaginaDescarga
 * (GET /cola-estado), independent d'ella. */
export function ColaBadge({ onVerPeces }: Props) {
  const [estat, setEstat] = useState<ColaEstado | null>(null);
  const [obert, setObert] = useState(false);
  const contenidorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelado = false;
    const poll = async () => {
      try {
        const data = await getColaEstado();
        if (!cancelado) setEstat(data);
      } catch {
        if (!cancelado) setEstat(null);
      }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      cancelado = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!obert) return;
    const onClickFora = (e: MouseEvent) => {
      if (contenidorRef.current && !contenidorRef.current.contains(e.target as Node))
        setObert(false);
    };
    document.addEventListener("mousedown", onClickFora);
    return () => document.removeEventListener("mousedown", onClickFora);
  }, [obert]);

  const procesando = estat?.procesando ?? false;
  const piezasListas = estat?.piezas_listas.length ?? 0;
  const cola = estat?.cola ?? [];
  const comandasListas = estat?.comandas_listas ?? [];

  return (
    <div ref={contenidorRef} className="relative">
      <button
        type="button"
        onClick={() => setObert((v) => !v)}
        title="Cua de correu automàtic"
        aria-label="Cua de correu automàtic"
        className={`relative flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-accent ${
          estat ? "text-primary" : "text-muted-foreground"
        }`}
      >
        <Inbox className="h-4 w-4" />
        {procesando && (
          <span className="absolute right-1 top-1 flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
          </span>
        )}
        {!procesando && piezasListas > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground">
            {piezasListas}
          </span>
        )}
      </button>

      {obert && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-40 w-80 rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card-hover)]">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-foreground">Monitorització de correu</span>
            <span
              className={`badge-pill ${estat ? "bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]" : "bg-[var(--badge-neutral-bg)] text-[var(--badge-neutral-text)]"}`}
            >
              {estat ? "Actiu" : "Sense connexió"}
            </span>
          </div>

          {procesando && (
            <p className="mt-3 text-xs text-primary">Processant: {estat?.fase_actual || "..."}</p>
          )}

          {cola.length > 0 && (
            <div className="mt-3">
              <span className="text-[11px] font-medium uppercase tracking-[0.05em] text-muted-foreground">
                En espera
              </span>
              <ul className="mt-1 space-y-1">
                {cola.map((c) => (
                  <li key={c} className="font-mono text-xs text-foreground">
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {comandasListas.length > 0 && (
            <div className="mt-3">
              <span className="text-[11px] font-medium uppercase tracking-[0.05em] text-muted-foreground">
                Comandes processades
              </span>
              <ul className="mt-1 space-y-1">
                {comandasListas.map((c) => (
                  <li key={c} className="font-mono text-xs text-foreground">
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!procesando && cola.length === 0 && comandasListas.length === 0 && (
            <p className="mt-3 text-xs text-muted-foreground">Sense activitat recent</p>
          )}

          {piezasListas > 0 && (
            <button
              type="button"
              onClick={() => {
                setObert(false);
                onVerPeces();
              }}
              className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-[#2952cc]"
            >
              Veure {piezasListas} peça{piezasListas === 1 ? "" : "s"} →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
