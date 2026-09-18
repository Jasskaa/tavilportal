import { useEffect, useState } from "react";
import { Settings, Moon, Sun, Printer, Download, FolderOpen, Palette, Wrench } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { getImpresoras, getImpresoraPreferida, setImpresoraPreferida } from "@/lib/api";
import { obtenirTemaGuardat, aplicarTema, type Tema } from "@/lib/tema";
import {
  obtenirUserConfig,
  guardarUserConfig,
  USER_CONFIG_BUIDA,
  RUTES_PER_DEFECTE,
  type UserConfig,
} from "@/lib/userConfig";

type Pestanya = "impressora" | "rutes" | "aparenca" | "avancat";

const PESTANYES: { id: Pestanya; label: string; icon: React.ReactNode }[] = [
  { id: "impressora", label: "Impressora", icon: <Printer className="h-3.5 w-3.5" /> },
  { id: "rutes", label: "Rutes", icon: <FolderOpen className="h-3.5 w-3.5" /> },
  { id: "aparenca", label: "Aparença", icon: <Palette className="h-3.5 w-3.5" /> },
  { id: "avancat", label: "Avançat", icon: <Wrench className="h-3.5 w-3.5" /> },
];

interface CampRutaProps {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}

function CampRuta({ label, value, placeholder, onChange }: CampRutaProps) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className="w-full rounded-lg border border-border bg-card px-2.5 py-1.5 font-mono text-[11px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2 focus:ring-primary/20"
      />
    </label>
  );
}

export function BotonAjustos() {
  const [obert, setObert] = useState(false);
  const [pestanya, setPestanya] = useState<Pestanya>("impressora");
  const [impresoras, setImpresoras] = useState<string[]>([]);
  const [seleccionada, setSeleccionada] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardat, setGuardat] = useState(false);
  const [tema, setTema] = useState<Tema>("fosc");
  const [rutes, setRutes] = useState<UserConfig>(USER_CONFIG_BUIDA);

  useEffect(() => {
    if (!obert) return;
    setSeleccionada(getImpresoraPreferida());
    setTema(obtenirTemaGuardat());
    setRutes(obtenirUserConfig());
    setGuardat(false);
    setCargando(true);
    setError(null);
    getImpresoras()
      .then(({ impresoras }) => setImpresoras(impresoras))
      .catch((e) => setError(e instanceof Error ? e.message : "Error carregant impressores"))
      .finally(() => setCargando(false));
  }, [obert]);

  const guardar = () => {
    setImpresoraPreferida(seleccionada);
    guardarUserConfig(rutes);
    setGuardat(true);
    setTimeout(() => setGuardat(false), 2000);
  };

  const canviarTema = (t: Tema) => {
    setTema(t);
    aplicarTema(t);
  };

  const restaurarRutesPerDefecte = () => {
    setRutes(USER_CONFIG_BUIDA);
  };

  return (
    <Dialog open={obert} onOpenChange={setObert}>
      <button
        type="button"
        onClick={() => setObert(true)}
        title="Ajustos"
        aria-label="Ajustos"
        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Settings className="h-4 w-4" />
      </button>

      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-[20px] sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Ajustos</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-1 border-b border-border">
          {PESTANYES.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPestanya(p.id)}
              className={`relative flex items-center gap-1.5 px-3 pb-2.5 text-sm font-medium transition-colors ${
                pestanya === p.id
                  ? "text-primary"
                  : "text-muted-foreground hover:text-secondary-foreground"
              }`}
            >
              {p.icon}
              {p.label}
              {pestanya === p.id && (
                <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" />
              )}
            </button>
          ))}
        </div>

        {pestanya === "impressora" && (
          <div className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="impresora-preferida" className="text-sm text-muted-foreground">
                La meva impressora
              </label>
              {cargando ? (
                <p className="text-sm text-muted-foreground">Carregant impressores...</p>
              ) : error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : (
                <select
                  id="impresora-preferida"
                  value={seleccionada}
                  onChange={(e) => setSeleccionada(e.target.value)}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                >
                  <option value="">— Selecciona una impressora —</option>
                  {impresoras.map((imp) => (
                    <option key={imp} value={imp}>
                      {imp}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="space-y-2">
              <span className="text-sm text-muted-foreground">Quan es processa una comanda</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setRutes((r) => ({ ...r, accioDocuments: "imprimir" }))}
                  className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    rutes.accioDocuments === "imprimir"
                      ? "border-primary bg-accent text-primary"
                      : "border-border text-muted-foreground hover:bg-accent hover:text-secondary-foreground"
                  }`}
                >
                  <Printer className="h-4 w-4" />
                  Imprimir documents
                </button>
                <button
                  type="button"
                  onClick={() => setRutes((r) => ({ ...r, accioDocuments: "descarregar" }))}
                  className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    rutes.accioDocuments === "descarregar"
                      ? "border-primary bg-accent text-primary"
                      : "border-border text-muted-foreground hover:bg-accent hover:text-secondary-foreground"
                  }`}
                >
                  <Download className="h-4 w-4" />
                  Descarregar a l'ordinador
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground/80">
                Només afecta el flux automàtic (correu) i "Entorn de proves" — la descàrrega manual
                ja té els seus propis botons "Imprimir tot"/"Descarregar tot" per comanda.
              </p>
            </div>
          </div>
        )}

        {pestanya === "rutes" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Les meves rutes</span>
              <button
                type="button"
                onClick={restaurarRutesPerDefecte}
                className="text-xs text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
              >
                Restaurar per defecte
              </button>
            </div>
            <div className="space-y-2">
              <CampRuta
                label="Plànols fabricació"
                value={rutes.rutaPlanolsFabricacio}
                placeholder={RUTES_PER_DEFECTE.rutaPlanolsFabricacio}
                onChange={(v) => setRutes((r) => ({ ...r, rutaPlanolsFabricacio: v }))}
              />
              <CampRuta
                label="Plànols taller"
                value={rutes.rutaPlanolsTaller}
                placeholder={RUTES_PER_DEFECTE.rutaPlanolsTaller}
                onChange={(v) => setRutes((r) => ({ ...r, rutaPlanolsTaller: v }))}
              />
              <CampRuta
                label="Excels de costos"
                value={rutes.rutaExcels}
                placeholder={RUTES_PER_DEFECTE.rutaExcels}
                onChange={(v) => setRutes((r) => ({ ...r, rutaExcels: v }))}
              />
              <CampRuta
                label="PDFs comercials"
                value={rutes.rutaComercial}
                placeholder={RUTES_PER_DEFECTE.rutaComercial}
                onChange={(v) => setRutes((r) => ({ ...r, rutaComercial: v }))}
              />
            </div>
            <p className="text-[11px] text-muted-foreground/80">
              Deixa un camp buit per fer servir la ruta per defecte del servidor.
            </p>
          </div>
        )}

        {pestanya === "avancat" && (
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-card px-3 py-3">
              <div>
                <span className="text-sm font-medium text-foreground">Entorn de proves</span>
                <p className="mt-0.5 text-[11px] text-muted-foreground/80">
                  Eina per simular la recepció d'un correu sense esperar-ne un de real — pensada
                  només per fer proves puntuals. Amagada per defecte a "Descàrrega" perquè no
                  molesti al dia a dia.
                </p>
              </div>
              <Switch
                checked={rutes.mostrarEntornProves}
                onCheckedChange={(v) => setRutes((r) => ({ ...r, mostrarEntornProves: v }))}
                aria-label="Mostrar entorn de proves"
              />
            </div>
          </div>
        )}

        {pestanya === "aparenca" && (
          <div className="space-y-2">
            <span className="text-sm text-muted-foreground">Aparença</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => canviarTema("clar")}
                className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  tema === "clar"
                    ? "border-primary bg-accent text-primary"
                    : "border-border text-muted-foreground hover:bg-accent hover:text-secondary-foreground"
                }`}
              >
                <Sun className="h-4 w-4" />
                Clar
              </button>
              <button
                type="button"
                onClick={() => canviarTema("fosc")}
                className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  tema === "fosc"
                    ? "border-primary bg-accent text-primary"
                    : "border-border text-muted-foreground hover:bg-accent hover:text-secondary-foreground"
                }`}
              >
                <Moon className="h-4 w-4" />
                Fosc
              </button>
            </div>
          </div>
        )}

        <DialogFooter>
          <button
            type="button"
            onClick={guardar}
            disabled={cargando}
            className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-[#2952cc] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {guardat ? "Configuració desada ✓" : "Desar"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
