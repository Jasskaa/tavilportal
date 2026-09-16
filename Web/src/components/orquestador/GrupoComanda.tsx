import { useState } from "react";
import { Download, Printer, Loader2, Check } from "lucide-react";
import { descargarTodo, imprimirComanda, getImpresoraPreferida, type PiezaResult } from "@/lib/api";
import { useUserConfig } from "@/hooks/use-user-config";
import { PiezaDescargaCard } from "./PiezaDescargaCard";

interface Props {
  comanda: string;
  piezas: PiezaResult[];
}

/** Bloque de una comanda dentro de la lista de piezas descargadas: cabecera
 * con el número de comanda + "Descargar tot" (ZIP con todos los PDFs de esa
 * comanda) + "Imprimir tot" (reimpresión manual, por si la automática del
 * flujo de correo no se ha disparado) y debajo una fila por pieza (código
 * PDM + descripció + Excel). */
export function GrupoComanda({ comanda, piezas }: Props) {
  const { config } = useUserConfig();
  const [descargando, setDescargando] = useState(false);
  const [errorDescarga, setErrorDescarga] = useState<string | null>(null);

  const [imprimiendo, setImprimiendo] = useState(false);
  const [okImprimir, setOkImprimir] = useState<string | null>(null);
  const [errorImprimir, setErrorImprimir] = useState<string | null>(null);

  const descargarTot = async () => {
    setErrorDescarga(null);
    setDescargando(true);
    try {
      await descargarTodo(comanda, config);
    } catch (e) {
      setErrorDescarga(e instanceof Error ? e.message : "Error al descarregar");
      setTimeout(() => setErrorDescarga(null), 4000);
    } finally {
      setDescargando(false);
    }
  };

  const imprimirTot = async () => {
    const impresora = getImpresoraPreferida();
    if (!impresora) {
      setErrorImprimir("Configura la teva impressora a Ajustos abans d'imprimir");
      setTimeout(() => setErrorImprimir(null), 5000);
      return;
    }
    setErrorImprimir(null);
    setImprimiendo(true);
    try {
      const r = await imprimirComanda(comanda, impresora, config);
      setOkImprimir(`${r.impresos}/${r.total} imprès`);
      setTimeout(() => setOkImprimir(null), 3000);
    } catch (e) {
      setErrorImprimir(e instanceof Error ? e.message : "Error en imprimir");
      setTimeout(() => setErrorImprimir(null), 4000);
    } finally {
      setImprimiendo(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-md border border-[var(--panel-border-1)] bg-[var(--panel-bg-2)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--panel-border-1)] px-4 py-3">
        <span className="font-mono text-[16px] font-semibold text-[var(--panel-text-1)]">{comanda}</span>
        <div className="flex items-center gap-2">
          {(errorDescarga || errorImprimir) && (
            <span className="text-[11px] text-destructive">{errorDescarga || errorImprimir}</span>
          )}
          <button
            type="button"
            onClick={imprimirTot}
            disabled={imprimiendo}
            title="Imprimir tot"
            className="flex items-center gap-1.5 rounded border border-[var(--panel-border-1)] px-2.5 py-1.5 text-[12px] text-[var(--panel-text-2)] transition-colors hover:bg-[var(--panel-border-1)] hover:text-[var(--panel-text-1)] disabled:cursor-wait disabled:opacity-60"
          >
            {imprimiendo ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : okImprimir ? (
              <Check className="h-3.5 w-3.5 text-success" />
            ) : (
              <Printer className="h-3.5 w-3.5" />
            )}
            {okImprimir ?? "Imprimir tot"}
          </button>
          <button
            type="button"
            onClick={descargarTot}
            disabled={descargando}
            title="Descarregar tot"
            className="flex items-center gap-1.5 rounded border border-[var(--panel-border-1)] px-2.5 py-1.5 text-[12px] text-[var(--panel-text-2)] transition-colors hover:bg-[var(--panel-border-1)] hover:text-[var(--panel-text-1)] disabled:cursor-wait disabled:opacity-60"
          >
            {descargando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Descarregar tot
          </button>
        </div>
      </div>

      <ul className="divide-y divide-[var(--panel-border-1)]">
        {piezas.map((p) => (
          <PiezaDescargaCard key={p.file} pieza={p} />
        ))}
      </ul>
    </div>
  );
}
