import { useState } from "react";
import { FileSpreadsheet, TriangleAlert } from "lucide-react";
import { urlArchivoExcel, type PiezaResult } from "@/lib/api";
import { useUserConfig } from "@/hooks/use-user-config";
import { ModalDiferenciesPlanol } from "./ModalDiferenciesPlanol";

interface Props {
  pieza: PiezaResult;
}

/** Fila de pieza dentro del grupo de su comanda (ver GrupoComanda): código
 * PDM + descripció, botón Excel, y — si el comparador de plànols encontró
 * una revisión anterior — un badge de diferencias (naranja, clicable, abre
 * el modal) o "Sense canvis" (gris). Sin badge si no había nada que
 * comparar. Sin botón de imprimir individual — la impresión ya se hace
 * automáticamente al procesar la comanda (correo) o queda cubierta por
 * "Descarregar/Imprimir tot" del grupo. */
export function PiezaDescargaCard({ pieza }: Props) {
  const { config } = useUserConfig();
  const [modalObert, setModalObert] = useState(false);

  const codigoCliente = (pieza.file.split("-")[0] ?? "").split(".")[0]?.trim() ?? "";
  const codigo = pieza.excelEncontrado ? pieza.ref : codigoCliente;

  return (
    <li className="flex flex-col gap-2 px-4 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="font-mono text-[14px] text-[var(--panel-text-1)]">{codigo || "—"}</span>
          <p className="truncate text-[13px] text-[var(--panel-text-3)]">{pieza.desc || pieza.file}</p>
        </div>

        <button
          type="button"
          disabled={!pieza.tiene_excel}
          title={pieza.tiene_excel ? "Excel" : "Excel no disponible"}
          onClick={pieza.tiene_excel ? () => window.open(urlArchivoExcel(codigoCliente, config), "_blank") : undefined}
          className={`flex shrink-0 items-center gap-1 rounded border border-[var(--panel-border-1)] px-2 py-1.5 text-[11px] text-[var(--panel-text-2)] transition-colors ${
            pieza.tiene_excel ? "hover:bg-[var(--panel-border-1)] hover:text-[var(--panel-text-1)]" : "cursor-not-allowed opacity-30"
          }`}
        >
          <FileSpreadsheet className="h-3 w-3 shrink-0" />
          Excel
        </button>
      </div>

      {pieza.tiene_diferencias === true && (
        <button
          type="button"
          onClick={() => setModalObert(true)}
          className="flex w-fit items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1 text-[11px] font-medium text-warning transition-colors hover:bg-warning/20"
        >
          <TriangleAlert className="h-3 w-3" />
          Diferències detectades ({pieza.num_diferencias ?? 0})
        </button>
      )}
      {pieza.tiene_diferencias === false && (
        <span className="w-fit rounded-full border border-[var(--panel-border-1)] px-2.5 py-1 text-[11px] text-[var(--panel-text-4)]">
          Sense canvis
        </span>
      )}

      {pieza.tiene_diferencias === true && (
        <ModalDiferenciesPlanol
          open={modalObert}
          onOpenChange={setModalObert}
          comanda={pieza.comanda}
          nombreArchivo={pieza.pdf_diferencias ?? ""}
          codigo={codigo || pieza.file}
          diferencias={pieza.diferencias ?? []}
        />
      )}
    </li>
  );
}
