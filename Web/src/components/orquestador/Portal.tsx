import { useState } from "react";
import { Search, Download, Trash2, History } from "lucide-react";
import { motion } from "framer-motion";
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
      <header className="z-30 flex h-20 shrink-0 items-center bg-background">
        <div className="mx-auto flex h-full w-full max-w-[1400px] items-center justify-between gap-4 px-8">
          {/* Esquerra — logo */}
          <div className="flex shrink-0 items-center gap-2.5">
            <span className="text-[15px] font-semibold tracking-tight text-foreground">
              Tavil <span className="font-normal text-muted-foreground">· Domoli</span>
            </span>
          </div>

          {/* Centre — navegació en pill, amb indicador actiu que llisca */}
          <nav className="relative flex h-12 items-center gap-1 rounded-full border border-border bg-card p-1.5 shadow-[var(--shadow-card)]">
            {SECCIONES.map((s) => {
              const actiu = seccion === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSeccion(s.id)}
                  className={`relative z-10 flex h-9 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors ${
                    actiu ? "text-primary-foreground" : "text-muted-foreground hover:text-secondary-foreground"
                  }`}
                >
                  {actiu && (
                    <motion.span
                      layoutId="navPillActiva"
                      className="absolute inset-0 -z-10 rounded-full bg-primary"
                      transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
                    />
                  )}
                  {s.icon}
                  <span className="whitespace-nowrap">{s.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Dreta — cua, ajustos, agrupats en un pill a joc amb el centre */}
          <div className="flex shrink-0 items-center gap-1 rounded-full border border-border bg-card p-1.5 shadow-[var(--shadow-card)]">
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
