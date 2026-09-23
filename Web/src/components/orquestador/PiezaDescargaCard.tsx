import { useState } from "react";
import { FileSpreadsheet, TriangleAlert, RefreshCw } from "lucide-react";
import { urlArchivoExcel, refrescarPieza, type PiezaResult } from "@/lib/api";
import { useUserConfig } from "@/hooks/use-user-config";
import { calcularEstatPeca, ETIQUETA_ESTAT_PECA } from "@/lib/utils";
import { ModalDiferenciesPlanol } from "./ModalDiferenciesPlanol";

interface Props {
  pieza: PiezaResult;
}

/** Fila de pieza dentro del grupo de su comanda (ver GrupoComanda): código
 * PDM + descripció, botón Excel, badge d'estat (Nova / Versió nova amb
 * diferències / Ja existia) i botó per tornar a buscar l'Excel — les peces
 * noves normalment encara no en tenen quan es descarreguen (algú se'l fa
 * després), així que aquest botó permet omplir desc/tract/gruix un cop
 * existeixi, sense haver de refer tota la descàrrega. Sin botón de imprimir
 * individual — la impresión ya se hace automáticamente al procesar la
 * comanda (correo) o queda cubierta por "Descarregar/Imprimir tot" del
 * grupo. */
export function PiezaDescargaCard({ pieza: piezaInicial }: Props) {
  const { config } = useUserConfig();
  const [pieza, setPieza] = useState(piezaInicial);
  const [modalObert, setModalObert] = useState(false);
  const [refrescant, setRefrescant] = useState(false);

  const codigoCliente = (pieza.file.split("-")[0] ?? "").split(".")[0]?.trim() ?? "";
  const codigo = pieza.excelEncontrado ? pieza.ref : codigoCliente;
  const estat = calcularEstatPeca(pieza);

  const refrescar = async () => {
    setRefrescant(true);
    try {
      const r = await refrescarPieza(pieza.ref || codigoCliente);
      if (r.encontrado) {
        setPieza((p) => ({
          ...p,
          ref: r.ref || p.ref,
          refCliente: r.refCliente ?? p.refCliente,
          desc: r.desc ?? p.desc,
          tract: r.tract ?? p.tract,
          grosor: r.grosor ?? p.grosor,
          excelEncontrado: true,
          tiene_excel: true,
        }));
      }
    } catch {
      /* silencio — es pot tornar a provar */
    } finally {
      setRefrescant(false);
    }
  };

  return (
    <li className="flex flex-col gap-2 px-4 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="font-mono text-[14px] text-foreground">{codigo || "—"}</span>
          <p className="truncate text-[13px] text-muted-foreground">{pieza.desc || pieza.file}</p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {!pieza.tiene_excel && (
            <button
              type="button"
              onClick={refrescar}
              disabled={refrescant}
              title="Tornar a buscar l'Excel (per si ja s'ha creat)"
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-[11px] font-medium text-secondary-foreground transition-colors hover:bg-accent hover:text-primary disabled:cursor-wait disabled:opacity-60"
            >
              <RefreshCw className={`h-3 w-3 shrink-0 ${refrescant ? "animate-spin" : ""}`} />
              Excel?
            </button>
          )}
          <button
            type="button"
            disabled={!pieza.tiene_excel}
            title={pieza.tiene_excel ? "Excel" : "Excel encara no disponible"}
            onClick={
              pieza.tiene_excel
                ? () => window.open(urlArchivoExcel(codigoCliente, config), "_blank")
                : undefined
            }
            className={`flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-[11px] font-medium text-secondary-foreground transition-colors ${
              pieza.tiene_excel
                ? "hover:bg-accent hover:text-primary"
                : "cursor-not-allowed opacity-30"
            }`}
          >
            <FileSpreadsheet className="h-3 w-3 shrink-0" />
            Excel
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        {estat === "versio_nova" ? (
          <button
            type="button"
            onClick={() => setModalObert(true)}
            className="badge-pill w-fit bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)] transition-opacity hover:opacity-80"
          >
            <TriangleAlert className="h-3 w-3" />
            {ETIQUETA_ESTAT_PECA[estat]} ({pieza.num_diferencias ?? 0})
          </button>
        ) : (
          <span
            className={`badge-pill w-fit ${
              estat === "nova"
                ? "bg-[var(--badge-info-bg)] text-[var(--badge-info-text)]"
                : "bg-[var(--badge-neutral-bg)] text-[var(--badge-neutral-text)]"
            }`}
          >
            {ETIQUETA_ESTAT_PECA[estat]}
          </span>
        )}
        {!pieza.tiene_excel && (
          <span className="badge-pill w-fit bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)]">
            Sense Excel encara
          </span>
        )}
      </div>

      {estat === "versio_nova" && (
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
