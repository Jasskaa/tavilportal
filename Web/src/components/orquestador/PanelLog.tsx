import { useEffect, useRef, useState } from "react";
import { Trash2, Copy, Check } from "lucide-react";
import { urlLogStream, type LogEntry } from "@/lib/api";

const COLORES: Record<LogEntry["tipo"], string> = {
  INFO: "#e2e4e8",
  OK: "#22c55e",
  ERROR: "#ef4444",
  STEP: "#60a5fa",
  FILE: "#fbbf24",
  PRINT: "#fb923c",
  COMPARE: "#c084fc",
  WAIT: "#6b7280",
  PING: "transparent",
};

const ICONOS: Record<LogEntry["tipo"], string> = {
  INFO: "⚡",
  OK: "✅",
  ERROR: "❌",
  STEP: "🔄",
  FILE: "📁",
  PRINT: "🖨️",
  COMPARE: "🔍",
  WAIT: "⏳",
  PING: "",
};

interface Props {
  /** Se llama con cada entrada nueva que llega por SSE (excepto PING) —
   * lo usa EntornProves para detectar cuándo termina la comanda que se
   * está simulando y refrescar la vista de piezas. */
  onEntry?: (entry: LogEntry) => void;
}

/** Panel de log en tiempo real conectado a GET /log-stream (SSE). Los
 * mensajes se acumulan mientras el componente está montado (no desaparecen
 * solos) — "Netejar log" los borra manualmente. */
export function PanelLog({ onEntry }: Props) {
  const [lineas, setLineas] = useState<LogEntry[]>([]);
  const [copiat, setCopiat] = useState(false);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const onEntryRef = useRef(onEntry);
  onEntryRef.current = onEntry;

  useEffect(() => {
    const es = new EventSource(urlLogStream());
    es.onmessage = (ev) => {
      let entry: LogEntry;
      try {
        entry = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (entry.tipo === "PING") return;
      setLineas((prev) => [...prev, entry]);
      onEntryRef.current?.(entry);
    };
    return () => es.close();
  }, []);

  useEffect(() => {
    const el = contenedorRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lineas]);

  const copiar = async () => {
    const texto = lineas.map((l) => `[${l.ts}] [${l.tipo}] ${l.msg}`).join("\n");
    try {
      await navigator.clipboard.writeText(texto);
      setCopiat(true);
      setTimeout(() => setCopiat(false), 2000);
    } catch {
      /* silencio */
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-border">
      <div className="flex items-center justify-between border-b border-border bg-card px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">Log en temps real</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={copiar}
            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {copiat ? (
              <Check className="h-3 w-3 text-[var(--badge-success-text)]" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
            Copiar log
          </button>
          <button
            type="button"
            onClick={() => setLineas([])}
            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <Trash2 className="h-3 w-3" />
            Netejar log
          </button>
        </div>
      </div>
      <div
        ref={contenedorRef}
        style={{
          background: "#0f1117",
          height: 350,
          fontFamily: "ui-monospace, monospace",
          fontSize: 12,
          color: "#e2e4e8",
        }}
        className="overflow-y-auto px-3 py-2"
      >
        {lineas.length === 0 ? (
          <p style={{ color: "#6b7280" }}>Esperant activitat...</p>
        ) : (
          lineas.map((l, i) => (
            <div key={i} className="whitespace-pre-wrap break-all leading-relaxed">
              <span style={{ color: "#6b7280" }}>[{l.ts}]</span> {ICONOS[l.tipo]}{" "}
              <span style={{ color: COLORES[l.tipo] }}>{l.msg}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
