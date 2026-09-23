import { useCallback, useEffect, useRef, useState } from "react";
import { Search, ChevronDown, RefreshCw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { buscarPiezas, reindexar, getIndiceEstado, type PiezaIndice } from "@/lib/api";
import { useUserConfig } from "@/hooks/use-user-config";
import { PiezaPortalCard } from "./PiezaPortalCard";

const EASE_HERO = [0.4, 0, 0.2, 1] as const;
const DUR_HERO = 0.35;

interface CampoFiltro {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}

function InputFiltre({ label, placeholder, value, onChange }: CampoFiltro) {
  return (
    <label className="flex min-w-[140px] flex-1 flex-col gap-1.5">
      <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--panel-text-5)]">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="rounded-[2px] border-b border-[var(--panel-border-2)] bg-transparent py-2 text-[15px] text-[var(--panel-text-1)] outline-none transition-colors duration-200 placeholder:text-[var(--panel-border-2)] hover:border-[var(--panel-text-5)] focus:border-[var(--panel-accent)]"
      />
    </label>
  );
}

export function PaginaBuscador() {
  const [q, setQ] = useState("");
  const [tractament, setTractament] = useState("");
  const [grosor, setGrosor] = useState("");
  const [codigoPdm, setCodigoPdm] = useState("");
  const [codigoCliente, setCodigoCliente] = useState("");
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);

  const [resultados, setResultados] = useState<PiezaIndice[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buscado, setBuscado] = useState(false);
  const [actualitzantIndex, setActualitzantIndex] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollIndex = useRef<ReturnType<typeof setInterval> | null>(null);
  const { config } = useUserConfig();

  const hayAlgo = !!(
    q.trim() ||
    tractament.trim() ||
    grosor.trim() ||
    codigoPdm.trim() ||
    codigoCliente.trim()
  );

  const executarCerca = useCallback(() => {
    if (!hayAlgo) return;
    setLoading(true);
    setError(null);
    buscarPiezas({ q, tractament, grosor, codigoPdm, codigoCliente }, config)
      .then(({ resultados, total }) => {
        setResultados(resultados);
        setTotal(total);
        setBuscado(true);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error al buscar"))
      .finally(() => setLoading(false));
  }, [q, tractament, grosor, codigoPdm, codigoCliente, hayAlgo, config]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!hayAlgo) {
      setResultados([]);
      setTotal(0);
      setBuscado(false);
      setError(null);
      return;
    }
    timer.current = setTimeout(executarCerca, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [hayAlgo, executarCerca]);

  // Neteja el polling si el component es desmunta mentre s'està actualitzant.
  useEffect(() => {
    return () => {
      if (pollIndex.current) clearInterval(pollIndex.current);
    };
  }, []);

  const actualitzarIndex = async () => {
    if (actualitzantIndex) return;
    setActualitzantIndex(true);
    try {
      await reindexar(config);
    } catch {
      setActualitzantIndex(false);
      return;
    }
    let haVistEnCurs = false;
    let intents = 0;
    pollIndex.current = setInterval(async () => {
      intents += 1;
      try {
        const estat = await getIndiceEstado();
        if (estat.indexando) haVistEnCurs = true;
        if ((haVistEnCurs && !estat.indexando) || intents > 400) {
          if (pollIndex.current) clearInterval(pollIndex.current);
          pollIndex.current = null;
          setActualitzantIndex(false);
          executarCerca();
        }
      } catch {
        /* silencio — es reintenta al proper interval */
      }
    }, 3000);
  };

  const netejarFiltres = () => {
    setTractament("");
    setGrosor("");
    setCodigoPdm("");
    setCodigoCliente("");
  };

  const hiHaFiltres = !!(tractament || grosor || codigoPdm || codigoCliente);
  const amplariHero = hayAlgo ? "w-full" : "w-[92%] max-w-[820px]";

  return (
    // absolute (no fixed): llena exactamente el área de contenido junto a la
    // barra superior del portal (su padre en Portal.tsx es `relative`).
    <div className="absolute inset-0 flex flex-col overflow-hidden bg-[var(--panel-bg-0)]">
      {/* Bloque título + buscador + filtros — hace de morph entre el
          estado centrado inicial y la barra superior fija con resultados. */}
      <motion.div
        layout
        transition={{ duration: DUR_HERO, ease: EASE_HERO }}
        className={
          hayAlgo
            ? "z-20 flex w-full flex-col border-b border-[var(--panel-border-0)] bg-[var(--panel-bg-0)] px-4 py-3 sm:px-6"
            : "z-20 flex w-full flex-1 flex-col items-center justify-center px-4 sm:px-6"
        }
      >
        <motion.div
          layout
          transition={{ duration: DUR_HERO, ease: EASE_HERO }}
          className={
            hayAlgo
              ? "mx-auto flex w-full max-w-[1400px] items-center gap-4"
              : "flex w-full flex-col items-center"
          }
        >
          <motion.span
            layout
            transition={{ duration: DUR_HERO, ease: EASE_HERO }}
            className={
              hayAlgo
                ? "shrink-0 font-extralight text-[18px] text-[var(--panel-text-1)]"
                : "font-extralight text-[var(--panel-text-1)]"
            }
            style={{
              letterSpacing: "-0.02em",
              fontSize: hayAlgo ? 18 : "clamp(48px, 8vw, 96px)",
              lineHeight: 1,
            }}
          >
            Tavil
          </motion.span>

          <AnimatePresence>
            {!hayAlgo && (
              <motion.p
                key="subtitol"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="mt-3 text-[15px] font-light tracking-wide text-[var(--panel-text-5)]"
              >
                1076 · Domoli
              </motion.p>
            )}
          </AnimatePresence>

          <motion.div
            layout
            transition={{ duration: DUR_HERO, ease: EASE_HERO }}
            className={hayAlgo ? "relative min-w-0 flex-1" : `relative mt-12 ${amplariHero}`}
          >
            <Search
              className={
                hayAlgo
                  ? "pointer-events-none absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2"
                  : "pointer-events-none absolute left-0 top-1/2 h-5 w-5 -translate-y-1/2"
              }
              style={{ color: "var(--panel-text-5)" }}
            />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar pieza, referència, descripció o codi..."
              autoFocus
              className={
                hayAlgo
                  ? "w-full rounded-[2px] border-b border-[var(--panel-border-2)] bg-transparent py-2 pl-7 pr-2 text-[18px] text-[var(--panel-text-1)] outline-none transition-colors duration-200 placeholder:text-[var(--panel-border-2)] hover:border-[var(--panel-text-5)] focus:border-[var(--panel-accent)]"
                  : "w-full rounded-[2px] border-b border-[var(--panel-border-2)] bg-transparent py-4 pl-9 pr-2 text-[22px] font-light text-[var(--panel-text-1)] outline-none transition-colors duration-200 placeholder:text-[var(--panel-border-2)] hover:border-[var(--panel-text-5)] focus:border-[var(--panel-accent)]"
              }
            />
          </motion.div>
        </motion.div>

        <div
          className={
            hayAlgo
              ? "mx-auto mt-2.5 flex w-full max-w-[1400px] justify-end"
              : `mt-4 flex ${amplariHero} justify-end`
          }
        >
          <button
            type="button"
            onClick={() => setFiltrosAbiertos((v) => !v)}
            className="flex items-center gap-1 text-[12px] font-medium tracking-wide text-[var(--panel-text-5)] transition-colors hover:text-[var(--panel-text-3)]"
          >
            Filtres
            <ChevronDown
              className="h-3 w-3 transition-transform duration-200"
              style={{ transform: filtrosAbiertos ? "rotate(180deg)" : "rotate(0deg)" }}
            />
          </button>
        </div>

        <AnimatePresence>
          {filtrosAbiertos && (
            <motion.div
              initial={{ opacity: 0, y: -8, height: 0 }}
              animate={{ opacity: 1, y: 0, height: "auto" }}
              exit={{ opacity: 0, y: -8, height: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className={
                hayAlgo
                  ? "mx-auto w-full max-w-[1400px] overflow-hidden"
                  : `${amplariHero} overflow-hidden`
              }
            >
              <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
                <InputFiltre
                  label="Codi client"
                  placeholder="103617..."
                  value={codigoCliente}
                  onChange={setCodigoCliente}
                />
                <InputFiltre
                  label="Codi PDM"
                  placeholder="10760000..."
                  value={codigoPdm}
                  onChange={setCodigoPdm}
                />
                <InputFiltre
                  label="Tractament"
                  placeholder="Zincat, pintat..."
                  value={tractament}
                  onChange={setTractament}
                />
                <InputFiltre
                  label="Grosor"
                  placeholder="2.0..."
                  value={grosor}
                  onChange={setGrosor}
                />
              </div>
              {hiHaFiltres && (
                <button
                  type="button"
                  onClick={netejarFiltres}
                  className="mt-3 text-[12px] text-[var(--panel-text-5)] transition-colors hover:text-[var(--panel-text-3)]"
                >
                  Netejar filtres
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Resultados */}
      <AnimatePresence>
        {hayAlgo && (
          <motion.main
            key="resultats"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ delay: 0.1, duration: 0.25 }}
            className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-10"
          >
            <div className="mx-auto w-full max-w-[1400px]">
              {loading && resultados.length === 0 ? null : error ? (
                <p className="py-16 text-center text-[13px]" style={{ color: "var(--panel-text-5)" }}>
                  {error}
                </p>
              ) : buscado && resultados.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-16">
                  <p className="text-[13px]" style={{ color: "var(--panel-text-5)" }}>
                    Cap resultat per a «{q}»
                  </p>
                  <p className="max-w-sm text-center text-[12px]" style={{ color: "var(--panel-text-5)" }}>
                    Si la peça és nova, potser encara no s'ha indexat — l'índex es refresca sol cada 10
                    minuts, o pots forçar-ho ara.
                  </p>
                  <button
                    type="button"
                    onClick={actualitzarIndex}
                    disabled={actualitzantIndex}
                    className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-accent disabled:cursor-wait disabled:opacity-60"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${actualitzantIndex ? "animate-spin" : ""}`} />
                    {actualitzantIndex ? "Actualitzant índex... (pot trigar uns minuts)" : "Actualitzar índex"}
                  </button>
                </div>
              ) : (
                <>
                  <p className="mb-4 text-[12px]" style={{ color: "var(--panel-text-5)" }}>
                    {total > resultados.length
                      ? `${resultados.length} de ${total} resultats — afina la cerca per veure'ls tots`
                      : `${total} resultat${total === 1 ? "" : "s"}`}
                  </p>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {resultados.map((p, i) => (
                      <motion.div
                        key={`${p.codigoCliente}_${p.codigoPdm}`}
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 + Math.min(i, 20) * 0.03, duration: 0.25 }}
                      >
                        <PiezaPortalCard pieza={p} />
                      </motion.div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </motion.main>
        )}
      </AnimatePresence>
    </div>
  );
}
