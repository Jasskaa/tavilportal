import { useCallback, useEffect, useRef, useState } from "react";
import { FlaskConical, Loader2, Printer, Download } from "lucide-react";
import {
  subirPdfCorreoTest,
  simularAutoDescargar,
  descargarPendiente,
  getColaEstado,
  limpiarPiezasListas,
  getAccioDocuments,
  type LogEntry,
  type PiezaResult,
} from "@/lib/api";
import { PanelLog } from "./PanelLog";
import { GrupoComanda } from "./GrupoComanda";

const PATRON_CODIGO = /\b(\d{10})\b/;

/** "Entorn de proves": simula la recepció d'un correu (macro VBA) des del
 * navegador — sense necessitat d'enviar un correu real — per poder veure
 * pas a pas al panell de log tot el que fa el servidor en processar-lo.
 * NO envia "accion" al simular — el servidor sempre decideix segons la
 * configuració d'Ajustos (_accio_documents_defecte), exactament igual que
 * amb un correu real, així es prova el mateix camí de veritat. */
export function EntornProves() {
  const [assumpte, setAssumpte] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [errorValidacio, setErrorValidacio] = useState<string | null>(null);
  const [accioActual, setAccioActual] = useState<"imprimir" | "descargar">("imprimir");

  const [piezasResultado, setPiezasResultado] = useState<PiezaResult[] | null>(null);
  const comandaEsperandoRef = useRef<string | null>(null);
  const accioEsperandaRef = useRef<"imprimir" | "descargar">("imprimir");

  useEffect(() => {
    getAccioDocuments()
      .then(({ accio }) => setAccioActual(accio))
      .catch(() => {
        /* silencio — es queda amb "imprimir" per defecte */
      });
  }, []);

  const onLogEntry = useCallback(async (entry: LogEntry) => {
    const comanda = comandaEsperandoRef.current;
    if (
      !comanda ||
      entry.tipo !== "OK" ||
      !entry.msg.includes(`Comanda ${comanda} processada completament`)
    ) {
      return;
    }
    comandaEsperandoRef.current = null;
    if (accioEsperandaRef.current === "descargar") {
      try {
        await descargarPendiente(comanda);
      } catch {
        /* silencio — el missatge d'error ja ha sortit pel log */
      }
    }
    try {
      const estado = await getColaEstado();
      if (estado.piezas_listas.length) {
        setPiezasResultado(estado.piezas_listas);
        await limpiarPiezasListas();
      }
    } catch {
      /* silencio — el missatge d'error ja ha sortit pel log */
    }
  }, []);

  const simular = async () => {
    setErrorValidacio(null);
    const match = assumpte.match(PATRON_CODIGO);
    if (!match) {
      setErrorValidacio("L'assumpte ha de contenir un número de 10 dígits (p. ex. 4500354139)");
      return;
    }
    const comanda = match[1] ?? "";

    setEnviando(true);
    setPiezasResultado(null);
    comandaEsperandoRef.current = comanda;
    try {
      // Refresca l'accio just abans d'enviar (per si s'ha canviat a Ajustos
      // des que es va carregar aquesta pàgina) — cal saber-la per decidir
      // si cal anar a buscar el ZIP quan acabi de processar-se.
      const { accio } = await getAccioDocuments();
      accioEsperandaRef.current = accio;
      setAccioActual(accio);

      let pdfCorreo = "";
      if (pdfFile) {
        const { ruta } = await subirPdfCorreoTest(pdfFile);
        pdfCorreo = ruta;
      }
      await simularAutoDescargar(comanda, pdfCorreo);
    } catch (e) {
      setErrorValidacio(e instanceof Error ? e.message : "Error simulant la recepció del correu");
      comandaEsperandoRef.current = null;
    } finally {
      setEnviando(false);
    }
  };

  return (
    <section className="mt-6 rounded-2xl border border-dashed border-border bg-[var(--panel-bg-1)] p-5">
      <div className="flex items-center gap-2">
        <FlaskConical className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">Entorn de proves</h2>
        <span className="badge-pill bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)]">
          DEV
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Simula la recepció d'un correu sense esperar que arribi de veritat — útil per verificar el
        flux pas a pas.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto]">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Assumpte del correu</span>
          <input
            type="text"
            value={assumpte}
            disabled={enviando}
            onChange={(e) => setAssumpte(e.target.value)}
            placeholder="Comanda 4500354139 TAVIL"
            className="rounded-lg border border-border bg-card px-2.5 py-1.5 font-mono text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-40"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">PDF adjunt</span>
          <input
            type="file"
            accept=".pdf"
            disabled={enviando}
            onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
            className="rounded-lg border border-border bg-card px-2.5 py-[5px] text-xs text-foreground outline-none file:mr-2 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs disabled:opacity-40"
          />
        </label>

        <button
          type="button"
          onClick={simular}
          disabled={enviando || !assumpte.trim()}
          className="flex items-center justify-center gap-2 self-end rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-[#2952cc] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {enviando ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FlaskConical className="h-4 w-4" />
          )}
          Simular recepció de correu
        </button>
      </div>

      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {accioActual === "descargar" ? <Download className="h-3 w-3" /> : <Printer className="h-3 w-3" />}
        Mode actual: {accioActual === "descargar" ? "descarregar a l'ordinador" : "imprimir documents"}{" "}
        <span className="text-muted-foreground/60">(canvia-ho a Ajustos)</span>
      </p>

      {errorValidacio && <p className="mt-2 text-xs text-destructive">{errorValidacio}</p>}

      <div className="mt-4">
        <PanelLog onEntry={onLogEntry} />
      </div>

      {piezasResultado && piezasResultado.length > 0 && (
        <div className="mt-4">
          <p className="mb-3 text-xs uppercase tracking-wider text-muted-foreground">
            {piezasResultado.length} peça{piezasResultado.length === 1 ? "" : "s"} descarregada
            {piezasResultado.length === 1 ? "" : "s"}
          </p>
          <div className="flex flex-col gap-4">
            {Array.from(
              piezasResultado.reduce<Map<string, PiezaResult[]>>((grupos, p) => {
                const lista = grupos.get(p.comanda);
                if (lista) lista.push(p);
                else grupos.set(p.comanda, [p]);
                return grupos;
              }, new Map()),
            ).map(([comanda, piezas]) => (
              <GrupoComanda key={comanda} comanda={comanda} piezas={piezas} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
