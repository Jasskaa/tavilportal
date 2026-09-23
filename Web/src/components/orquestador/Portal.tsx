import { useState } from "react";
import { Search, Download, Trash2, History, Menu, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
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
  const [menuObert, setMenuObert] = useState(false);

  const setSeccion = (s: Seccion) => {
    setSeccionState(s);
    onSeccionChange(s);
    setMenuObert(false);
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* Barra superior — sempre visible, en les quatre seccions */}
      <header className="relative z-30 flex h-16 shrink-0 items-center bg-background sm:h-20">
        <div className="mx-auto flex h-full w-full max-w-[1400px] items-center justify-between gap-2 px-3 sm:gap-4 sm:px-8">
          {/* Esquerra — logo (+ botó hamburguesa al mòbil) */}
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setMenuObert((v) => !v)}
              title="Menú"
              aria-label="Menú"
              className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:hidden"
            >
              {menuObert ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <span className="text-[15px] font-semibold tracking-tight text-foreground">
              Tavil <span className="hidden font-normal text-muted-foreground sm:inline">· Domoli</span>
            </span>
          </div>

          {/* Centre — navegació en pill, amb indicador actiu que llisca.
              Nomès visible a partir de "sm" — al mòbil es fa servir el menú
              hamburguesa de l'esquerra en comptes d'intentar encabir-la. */}
          <nav className="relative hidden h-12 items-center gap-1 rounded-full border border-border bg-card p-1.5 shadow-[var(--shadow-card)] sm:flex">
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

        {/* Menú desplegable mòbil — llista vertical de seccions, es tanca en
            triar-ne una o tocant fora. */}
        <AnimatePresence>
          {menuObert && (
            <>
              <motion.div
                key="overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                onClick={() => setMenuObert(false)}
                className="fixed inset-0 top-16 z-20 bg-black/30 sm:hidden"
              />
              <motion.nav
                key="menu"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.15 }}
                className="absolute left-3 right-3 top-full z-30 flex flex-col gap-1 rounded-2xl border border-border bg-card p-2 shadow-[var(--shadow-card-hover)] sm:hidden"
              >
                {SECCIONES.map((s) => {
                  const actiu = seccion === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSeccion(s.id)}
                      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                        actiu
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-secondary-foreground"
                      }`}
                    >
                      {s.icon}
                      {s.label}
                    </button>
                  );
                })}
              </motion.nav>
            </>
          )}
        </AnimatePresence>
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
