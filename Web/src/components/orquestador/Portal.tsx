import { useState } from "react";
import { Search, Download, Trash2 } from "lucide-react";
import { PaginaBuscador } from "./PaginaBuscador";
import { PaginaDescarga } from "./PaginaDescarga";
import { PaginaAnulador } from "./PaginaAnulador";
import { BotonAjustos } from "./ModalAjustos";

export type Seccion = "buscador" | "descarga" | "anulador";

export const SECCIONES: { id: Seccion; label: string; icon: React.ReactNode }[] = [
  { id: "buscador", label: "Buscador de piezas", icon: <Search className="h-4.5 w-4.5" /> },
  { id: "descarga", label: "Descarga de comandas", icon: <Download className="h-4.5 w-4.5" /> },
  { id: "anulador", label: "Anulador", icon: <Trash2 className="h-4.5 w-4.5" /> },
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
    // h-screen + overflow-hidden en el contenedor exterior: el sidebar y
    // la cabecera quedan siempre fijos y nunca se desplazan al hacer
    // scroll en el contenido, sea cual sea la sección activa.
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar — siempre visible, en las tres secciones */}
      <nav className="flex w-[60px] shrink-0 flex-col items-center gap-1 border-r border-border py-4">
        {SECCIONES.map((s) => (
          <button
            key={s.id}
            title={s.label}
            aria-label={s.label}
            onClick={() => setSeccion(s.id)}
            className={`flex h-11 w-11 items-center justify-center rounded-md transition-colors ${
              seccion === s.id
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            {s.icon}
          </button>
        ))}
      </nav>

      {seccion === "buscador" ? (
        // El buscador gestiona su propio título/buscador estilo Gemini como
        // cabecera — por eso no lleva el header estándar del portal — pero
        // vive dentro del área de contenido junto al sidebar, no a pantalla
        // completa.
        <div className="relative min-w-0 flex-1">
          <PaginaBuscador />
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Barra superior — logo + ajustes */}
          <header className="flex shrink-0 items-center justify-between border-b border-border px-6 py-3">
            <span className="text-sm text-foreground">1076 · Tavil</span>
            <BotonAjustos />
          </header>

          <main className="flex-1 overflow-y-auto">
            {seccion === "descarga" ? <PaginaDescarga /> : <PaginaAnulador />}
          </main>
        </div>
      )}
    </div>
  );
}
