import { useState } from "react";
import { Search, Download, Trash2, History } from "lucide-react";
import { PaginaBuscador } from "./PaginaBuscador";
import { PaginaDescarga } from "./PaginaDescarga";
import { PaginaAnulador } from "./PaginaAnulador";
import { PaginaHistorial } from "./PaginaHistorial";
import { BotonAjustos } from "./ModalAjustos";
import { ColaBadge } from "./ColaBadge";

export type Seccion = "buscador" | "descarga" | "anulador" | "historial";

export const SECCIONES: { id: Seccion; label: string; icon: React.ReactNode }[] = [
  { id: "buscador", label: "Cercar peces", icon: <Search className="h-4 w-4" /> },
  { id: "descarga", label: "Descàrrega", icon: <Download className="h-4 w-4" /> },
  { id: "anulador", label: "Anul·lador", icon: <Trash2 className="h-4 w-4" /> },
  { id: "historial", label: "Historial", icon: <History className="h-4 w-4" /> },
];

interface Props {
  seccionInicial: Seccion;
  onSeccionChange: (s: Seccion) => void;
}

export function Portal({ seccionInicial, onSeccionChange }: Props) {
  const [seccion, setSeccionState] = useState<Seccion>(seccionInicial);

  const setSeccion = (s: Seccion) => {
    setSeccionState(s);
    onSeccionChange(s);
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* Barra superior — sempre visible, en les quatre seccions */}
      <header className="z-30 flex h-16 shrink-0 items-center border-b border-border bg-card">
        <div className="mx-auto flex h-full w-full max-w-[1400px] items-center justify-between gap-4 px-8">
          {/* Esquerra — logo */}
          <div className="flex shrink-0 items-center gap-2.5">
            <span className="text-sm font-medium text-foreground">Tavil · Domoli</span>
          </div>

          {/* Centre — navegació per tabs */}
          <nav className="flex h-full items-center gap-1">
            {SECCIONES.map((s) => {
              const actiu = seccion === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSeccion(s.id)}
                  className={`relative flex h-full items-center gap-2 px-3 text-sm font-medium transition-colors ${
                    actiu ? "text-primary" : "text-muted-foreground hover:text-secondary-foreground"
                  }`}
                >
                  {s.icon}
                  {s.label}
                  {actiu && (
                    <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary" />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Dreta — cua, ajustos */}
          <div className="flex shrink-0 items-center gap-1">
            <ColaBadge onVerPeces={() => setSeccion("descarga")} />
            <BotonAjustos />
          </div>
        </div>
      </header>

      {seccion === "buscador" ? (
        // El buscador gestiona el seu propi scroll intern (absolute inset-0)
        // per poder fer el morph entre l'estat centrat inicial i la barra
        // superior amb resultats — per això no porta overflow-y-auto aquí.
        <div className="relative min-h-0 flex-1">
          <PaginaBuscador />
        </div>
      ) : (
        <main className="min-h-0 flex-1 overflow-y-auto">
          {seccion === "descarga" && <PaginaDescarga />}
          {seccion === "anulador" && <PaginaAnulador />}
          {seccion === "historial" && <PaginaHistorial />}
        </main>
      )}
    </div>
  );
}
