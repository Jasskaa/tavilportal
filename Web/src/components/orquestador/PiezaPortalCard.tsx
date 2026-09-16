import { FileText, Factory, FileSpreadsheet, type LucideIcon } from "lucide-react";
import { urlArchivoPlanolCliente, urlArchivoPlanolTaller, urlArchivoExcel, type PiezaIndice } from "@/lib/api";
import { useUserConfig } from "@/hooks/use-user-config";
import { GeoPreview } from "./GeoPreview";

interface Props {
  pieza: PiezaIndice;
}

function BotonArchivo({
  icon: Icon,
  label,
  disponible,
  url,
}: {
  icon: LucideIcon;
  label: string;
  disponible: boolean;
  url: string;
}) {
  return (
    <button
      type="button"
      disabled={!disponible}
      title={disponible ? label : "No disponible"}
      onClick={disponible ? () => window.open(url, "_blank") : undefined}
      className={`flex flex-1 items-center justify-center gap-1 rounded border border-[var(--panel-border-1)] px-1 py-1.5 text-[11px] text-[var(--panel-text-2)] transition-colors ${
        disponible ? "hover:bg-[var(--panel-border-1)] hover:text-[var(--panel-text-1)]" : "cursor-not-allowed opacity-30"
      }`}
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

export function PiezaPortalCard({ pieza }: Props) {
  const { config } = useUserConfig();

  return (
    <article
      className="flex flex-col overflow-hidden rounded-md border border-[var(--panel-border-1)] bg-[var(--panel-bg-2)]"
      style={{ borderLeft: `3px solid ${pieza.planolTaller ? "var(--panel-accent-2)" : "var(--panel-border-3)"}` }}
    >
      {/* Bloque de información — alto fijo, con más jerarquía visual para
          que compita mejor con el geo (código más grande, más aire). */}
      <div className="flex h-[190px] flex-col justify-between p-4">
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate font-mono text-[19px] font-semibold tracking-tight text-[var(--panel-text-1)]">
              {pieza.codigoPdm || "—"}
            </span>
            <span className="shrink-0 font-mono text-[13px] text-[var(--panel-text-4)]">
              {pieza.refCliente || "—"}
            </span>
          </div>
          <p className="mt-2 truncate text-[14px] text-[var(--panel-text-2)]">{pieza.desc || "—"}</p>
        </div>

        <div className="border-t border-[var(--panel-border-1)] pt-2.5">
          <div className="flex items-center justify-between text-[13px]">
            <span>
              <span className="text-[var(--panel-text-4)]">Gruix </span>
              <span className="font-medium text-[var(--panel-text-1)]">{pieza.grosor ? `${pieza.grosor} mm` : "—"}</span>
            </span>
            <span className="truncate text-right">
              <span className="text-[var(--panel-text-4)]">Tract. </span>
              <span className="font-medium text-[var(--panel-text-1)]">{pieza.tract || "—"}</span>
            </span>
          </div>
        </div>

        <div className="flex gap-1.5 border-t border-[var(--panel-border-1)] pt-2.5">
          <BotonArchivo
            icon={FileText}
            label="Plànol client"
            disponible={pieza.planolCliente}
            url={urlArchivoPlanolCliente(pieza.codigoCliente, config)}
          />
          <BotonArchivo
            icon={Factory}
            label="Plànol taller"
            disponible={pieza.planolTaller}
            url={urlArchivoPlanolTaller(pieza.codigoPdm, config)}
          />
          <BotonArchivo
            icon={FileSpreadsheet}
            label="Excel"
            disponible={pieza.excelDisponible}
            url={urlArchivoExcel(pieza.codigoCliente, config)}
          />
        </div>
      </div>

      {/* Previsualización del .geo (si existe) — fuera del bloque de alto fijo */}
      <GeoPreview codigoPdm={pieza.codigoPdm} config={config} />
    </article>
  );
}
