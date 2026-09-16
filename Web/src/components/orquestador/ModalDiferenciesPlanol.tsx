import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { urlPlanolDiferencias, descargarPlanolDiferencias, type DiferenciaPlanol } from "@/lib/api";
import { useUserConfig } from "@/hooks/use-user-config";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  comanda: string;
  nombreArchivo: string;
  codigo: string;
  diferencias: DiferenciaPlanol[];
}

function lineaDiferencia(d: DiferenciaPlanol): string {
  switch (d.tipo) {
    case "cambiat":
      return `Cota ${d.valor_anterior} → ${d.valor_nou}`;
    case "nou":
      return `Cota nova: ${d.valor_nou}`;
    case "eliminat":
      return `Cota eliminada: ${d.valor_anterior}`;
    case "vista_3d":
      return d.descripcio || "Canvis a la vista 3D/isomètrica";
    default:
      return "";
  }
}

/** Modal de diferencias de un plànol (ver comparar_planols en el servidor):
 * el PDF marcado a la izquierda (embebido con iframe) y la lista de
 * diferencias detectadas a la derecha, con botón de descarga. */
export function ModalDiferenciesPlanol({ open, onOpenChange, comanda, nombreArchivo, codigo, diferencias }: Props) {
  const { config } = useUserConfig();
  const [descargando, setDescargando] = useState(false);

  const descargar = async () => {
    setDescargando(true);
    try {
      await descargarPlanolDiferencias(comanda, nombreArchivo, config);
    } finally {
      setDescargando(false);
    }
  };

  const url = urlPlanolDiferencias(comanda, nombreArchivo, config);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-w-4xl flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="font-mono">{codigo} · Diferències</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 gap-4">
          <div className="min-w-0 flex-1 overflow-hidden rounded-md border border-border">
            <iframe src={url} title={`Diferències ${codigo}`} className="h-full w-full" />
          </div>

          <div className="flex w-64 shrink-0 flex-col">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              {diferencias.length} diferència{diferencias.length === 1 ? "" : "s"}
            </p>
            <ul className="mt-2 flex-1 space-y-1.5 overflow-y-auto pr-1 text-sm">
              {diferencias.map((d, i) => (
                <li key={i} className="rounded border border-border bg-surface px-2 py-1.5 text-xs text-foreground">
                  {lineaDiferencia(d)}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={descargar}
              disabled={descargando}
              className="mt-3 flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
            >
              {descargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Descarregar PDF diferències
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
