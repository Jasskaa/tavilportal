import {
  Ruler,
  FileText,
  Factory,
  FileSpreadsheet,
  ExternalLink,
  type LucideIcon,
} from "lucide-react";
import {
  urlArchivoPlanolCliente,
  urlArchivoPlanolTaller,
  urlArchivoExcel,
  type PiezaIndice,
} from "@/lib/api";
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
      className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-1 text-xs text-secondary-foreground transition-colors ${
        disponible ? "hover:bg-accent hover:text-primary" : "cursor-not-allowed opacity-35"
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{label}</span>
      {disponible && <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />}
    </button>
  );
}

export function PiezaPortalCard({ pieza }: Props) {
  const { config } = useUserConfig();

  return (
    <article
      className="card-elevated group flex flex-col overflow-hidden border border-border transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-hover)]"
      style={{ borderLeft: `3px solid ${pieza.planolTaller ? "var(--primary)" : "var(--border)"}` }}
    >
      <div className="flex flex-col gap-3 p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
            <Ruler className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate font-mono text-[15px] font-semibold text-foreground">
                {pieza.codigoPdm || "—"}
              </span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {pieza.refCliente || "—"}
              </span>
            </div>
            <p className="mt-1 truncate text-sm font-medium text-secondary-foreground">
              {pieza.desc || "—"}
            </p>
          </div>
        </div>

        <div className="border-t border-border pt-3">
          <div className="flex items-center justify-between text-[13px]">
            <span>
              <span className="text-[11px] font-medium uppercase tracking-[0.05em] text-muted-foreground">
                Gruix{" "}
              </span>
              <span className="font-medium text-foreground">
                {pieza.grosor ? `${pieza.grosor} mm` : "—"}
              </span>
            </span>
            <span className="truncate text-right">
              <span className="text-[11px] font-medium uppercase tracking-[0.05em] text-muted-foreground">
                Tract.{" "}
              </span>
              <span className="font-medium text-foreground">{pieza.tract || "—"}</span>
            </span>
          </div>
        </div>

        <div className="flex gap-2 border-t border-border pt-3">
          <BotonArchivo
            icon={FileText}
            label="Client"
            disponible={pieza.planolCliente}
            url={urlArchivoPlanolCliente(pieza.codigoCliente, config)}
          />
          <BotonArchivo
            icon={Factory}
            label="Taller"
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

      <GeoPreview codigoPdm={pieza.codigoPdm} config={config} />
    </article>
  );
}
