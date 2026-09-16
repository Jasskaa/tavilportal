import { useEffect, useState } from "react";
import { Settings, Moon, Sun, Printer, Download } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { getImpresoras, getImpresoraPreferida, setImpresoraPreferida } from "@/lib/api";
import { obtenirTemaGuardat, aplicarTema, type Tema } from "@/lib/tema";
import { obtenirUserConfig, guardarUserConfig, USER_CONFIG_BUIDA, RUTES_PER_DEFECTE, type UserConfig } from "@/lib/userConfig";

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
        className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 font-mono text-[11px] text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/60"
      />
    </label>
  );
}

export function BotonAjustos() {
  const [obert, setObert] = useState(false);
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

      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Configuració</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          <span className="text-sm text-muted-foreground">Aparença</span>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => canviarTema("fosc")}
              className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                tema === "fosc"
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              <Moon className="h-4 w-4" />
              Fosc
            </button>
            <button
              type="button"
              onClick={() => canviarTema("clar")}
              className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                tema === "clar"
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              <Sun className="h-4 w-4" />
              Clar
            </button>
          </div>
        </div>

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

        <div className="space-y-2">
          <span className="text-sm text-muted-foreground">Quan es processa una comanda</span>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setRutes((r) => ({ ...r, accioDocuments: "imprimir" }))}
              className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                rutes.accioDocuments === "imprimir"
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              <Printer className="h-4 w-4" />
              Imprimir documents
            </button>
            <button
              type="button"
              onClick={() => setRutes((r) => ({ ...r, accioDocuments: "descarregar" }))}
              className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                rutes.accioDocuments === "descarregar"
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              <Download className="h-4 w-4" />
              Descarregar a l'ordinador
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground/80">
            Només afecta el flux automàtic (correu) i "Entorn de proves" — la descàrrega manual ja té els seus propis
            botons "Imprimir tot"/"Descarregar tot" per comanda.
          </p>
        </div>

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
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary/60"
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

        <DialogFooter>
          <button
            type="button"
            onClick={guardar}
            disabled={cargando}
            className="flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {guardat ? "Configuració desada ✓" : "Desar"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
