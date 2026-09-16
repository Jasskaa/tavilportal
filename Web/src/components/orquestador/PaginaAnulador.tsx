import { useCallback, useEffect, useState, type ReactNode } from "react";
import { RefreshCw, Trash2, Loader2, TriangleAlert } from "lucide-react";
import {
  getAnuladorPlanols,
  getAnuladorGeos,
  getAnuladorProgrames,
  ejecutarAnuladorPlanols,
  ejecutarAnuladorGeos,
  ejecutarAnuladorProgrames,
  type AnuladorItemPlanol,
  type AnuladorItemGeo,
  type AnuladorItemPrograma,
  type AnuladorListaResponse,
  type AnuladorEjecutarResponse,
  type AnuladorEstado,
} from "@/lib/api";

const COLOR_ROJO = "var(--anulador-rojo)";
const FONS_ROJO = "var(--anulador-rojo-bg)";
const COLOR_VERD = "var(--anulador-verd)";

/** Mezcla el color base (rojo/verd) con transparente — reemplaza el
 * truco de sufijo hex de alpha (p.ej. `${hex}66`), que no funciona sobre
 * variables CSS. */
function conAlpha(color: string, porcentaje: number): string {
  return `color-mix(in srgb, ${color} ${porcentaje}%, transparent)`;
}

interface ColumnaProps<T extends { estado: AnuladorEstado }> {
  titulo: string;
  nomItems: string;
  labelBoton: string;
  cargar: () => Promise<AnuladorListaResponse<T>>;
  ejecutar: () => Promise<AnuladorEjecutarResponse>;
  nombreDe: (item: T) => ReactNode;
  revisioDe: (item: T) => string;
  /** Badge gris adicional junto a ANULAR — de momento solo lo usa
   * Programes, para indicar de qué màquina (5085/5230) viene cada item. */
  extraBadgeDe?: (item: T) => string;
}

function ColumnaAnulador<T extends { estado: AnuladorEstado }>({
  titulo,
  nomItems,
  labelBoton,
  cargar,
  ejecutar,
  nombreDe,
  revisioDe,
  extraBadgeDe,
}: ColumnaProps<T>) {
  const [items, setItems] = useState<T[]>([]);
  const [cargando, setCargando] = useState(false);
  const [cargado, setCargado] = useState(false);
  const [ejecutando, setEjecutando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [erroresCarpetes, setErroresCarpetes] = useState<string[]>([]);

  const recargar = useCallback(() => {
    setCargando(true);
    setError(null);
    cargar()
      .then(({ items, errores }) => {
        setItems(items);
        setCargado(true);
        setErroresCarpetes(errores ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error carregant la llista"))
      .finally(() => setCargando(false));
  }, [cargar]);

  useEffect(() => {
    recargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const itemsAnular = items.filter((i) => i.estado === "anular");

  const anular = async () => {
    if (!itemsAnular.length) return;
    const confirmado = window.confirm(`Segur que vols anular ${itemsAnular.length} ${nomItems}?`);
    if (!confirmado) return;
    setEjecutando(true);
    setError(null);
    try {
      const r = await ejecutar();
      if (r.errores.length) setError(r.errores.join(" · "));
      recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error executant l'anul·lació");
    } finally {
      setEjecutando(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col rounded-md border border-[var(--panel-border-1)] bg-[var(--panel-bg-2)] p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wider text-[var(--panel-text-1)]">{titulo}</h2>
        <button
          type="button"
          onClick={recargar}
          disabled={cargando}
          className="flex items-center gap-1.5 rounded border border-[var(--panel-border-1)] px-2.5 py-1.5 text-xs text-[var(--panel-text-2)] transition-colors hover:bg-[var(--panel-border-1)] hover:text-[var(--panel-text-1)] disabled:cursor-wait disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${cargando ? "animate-spin" : ""}`} />
          Actualitzar
        </button>
      </div>

      {erroresCarpetes.length > 0 && (
        <div className="mt-3 flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-xs text-warning">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="space-y-0.5">
            {erroresCarpetes.map((e, i) => (
              <p key={i}>{e}</p>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 min-h-[240px]">
        {cargando && !cargado ? (
          <p className="py-16 text-center text-sm text-[var(--panel-text-4)]">Carregant...</p>
        ) : itemsAnular.length === 0 ? (
          <p className="py-16 text-center text-sm text-[var(--panel-text-4)]">No hi ha items pendents d&apos;anul·lar</p>
        ) : (
          <ul className="max-h-[520px] space-y-2 overflow-y-auto overflow-x-hidden pr-1">
            {itemsAnular.map((item, i) => (
              <li
                key={i}
                className="group rounded-md border px-3 py-2.5"
                style={{ backgroundColor: FONS_ROJO, borderColor: conAlpha(COLOR_ROJO, 40) }}
              >
                <div className="flex items-start justify-between gap-3">
                  <span
                    className="min-w-0 flex-1 font-mono text-[13px] leading-snug"
                    style={{ color: COLOR_ROJO, wordBreak: "break-all", overflowWrap: "anywhere" }}
                  >
                    {nombreDe(item)}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {extraBadgeDe && (
                      <span className="rounded bg-[var(--panel-border-1)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--panel-text-3)]">
                        {extraBadgeDe(item)}
                      </span>
                    )}
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide"
                      style={{
                        color: COLOR_ROJO,
                        backgroundColor: conAlpha(COLOR_ROJO, 13),
                        border: `1px solid ${conAlpha(COLOR_ROJO, 33)}`,
                      }}
                    >
                      ANULAR
                    </span>
                  </span>
                </div>
                {/* Versió correcta — oculta per defecte, només es veu en fer hover
                    sobre l'ítem, per no competir visualment amb el que s'ha d'anular. */}
                <div
                  className="mt-1 text-[11px] opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                  style={{ color: COLOR_VERD }}
                >
                  {revisioDe(item)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

      <button
        type="button"
        onClick={anular}
        disabled={!itemsAnular.length || ejecutando || cargando}
        className="mt-4 flex items-center justify-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-30"
      >
        {ejecutando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        {labelBoton}
        {itemsAnular.length > 0 && <span className="opacity-70">({itemsAnular.length})</span>}
      </button>
    </div>
  );
}

export function PaginaAnulador() {
  return (
    <div className="mx-auto w-full max-w-[1600px] px-8 py-8">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3">
        <ColumnaAnulador<AnuladorItemPlanol>
          titulo="Plànols"
          nomItems="plànols"
          labelBoton="Anul·lar plànols"
          cargar={getAnuladorPlanols}
          ejecutar={ejecutarAnuladorPlanols}
          nombreDe={(item) => item.archivo_actual}
          revisioDe={(item) => `Versió correcta: REV${String(item.revision_activa).padStart(2, "0")} · .${item.ext}`}
        />
        <ColumnaAnulador<AnuladorItemGeo>
          titulo="Geos"
          nomItems="geos"
          labelBoton="Anul·lar geos"
          cargar={getAnuladorGeos}
          ejecutar={ejecutarAnuladorGeos}
          nombreDe={(item) => item.archivo_actual}
          revisioDe={(item) => `Versió correcta: v${item.version_activa}`}
        />
        <ColumnaAnulador<AnuladorItemPrograma>
          titulo="Programes"
          nomItems="programes"
          labelBoton="Anul·lar programes"
          cargar={getAnuladorProgrames}
          ejecutar={ejecutarAnuladorProgrames}
          nombreDe={(item) => (
            <div className="space-y-0.5">
              {item.archivos.map((a) => (
                <div key={a}>{a}</div>
              ))}
            </div>
          )}
          revisioDe={(item) => `Versió correcta: v${item.version_activa}`}
          extraBadgeDe={(item) => item.carpeta}
        />
      </div>
    </div>
  );
}
