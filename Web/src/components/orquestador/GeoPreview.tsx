import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { getGeo } from "@/lib/api";
import {
  parseGeo,
  contornosASvgPaths,
  geoViewBox,
  geoCentroNatural,
  type GeoParseado,
} from "@/lib/geoParser";
import type { UserConfig } from "@/lib/userConfig";

const ALTURA_GEO = 230; // visible pero equilibrado con el bloque de info de la tarjeta
const ZOOM_MIN = 1;
const ZOOM_MAX = 10;
const ZOOM_PASO_RUEDA = 0.0015; // por unidad de deltaY

type Estado = "esperando" | "cargando" | "encontrado" | "nada";
type Centro = { x: number; y: number };

interface Props {
  codigoPdm: string;
  config?: UserConfig;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * Previsualización del contorno del .geo de una pieza, equilibrada en
 * tamaño con el bloque de información de la tarjeta: zoom con la rueda
 * del ratón encima, arrastre con el ratón para desplazarla dentro del
 * recuadro, y las dimensiones reales (ancho × alto) en la cabecera.
 * Lazy: no pide nada hasta que la tarjeta entra en viewport, y si no hay
 * geo o no se puede parsear no muestra nada.
 */
export function GeoPreview({ codigoPdm, config }: Props) {
  const [estado, setEstado] = useState<Estado>(codigoPdm ? "esperando" : "nada");
  const [geo, setGeo] = useState<GeoParseado | null>(null);
  const [archivo, setArchivo] = useState("");
  const [zoom, setZoom] = useState(1);
  const [centro, setCentro] = useState<Centro | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const arrastreRef = useRef<{
    x: number;
    y: number;
    centroInicial: Centro;
    vbAncho: number;
    vbAlto: number;
  } | null>(null);

  // Fase 1: observar visibilidad, disparar la carga solo cuando entra en pantalla.
  useEffect(() => {
    if (estado !== "esperando") return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entradas) => {
        if (entradas[0]?.isIntersecting) {
          setEstado("cargando");
        }
      },
      { rootMargin: "150px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [estado]);

  // Fase 2: pedir y parsear el .geo una vez visible.
  useEffect(() => {
    if (estado !== "cargando") return;
    let cancelado = false;
    getGeo(codigoPdm, config)
      .then((r) => {
        if (cancelado) return;
        if (!r.encontrado || !r.contenido) {
          setEstado("nada");
          return;
        }
        const parseado = parseGeo(r.contenido);
        if (!parseado) {
          setEstado("nada");
          return;
        }
        setGeo(parseado);
        setArchivo(r.archivo ?? "");
        setEstado("encontrado");
      })
      .catch(() => {
        if (!cancelado) setEstado("nada");
      });
    return () => {
      cancelado = true;
    };
  }, [estado, codigoPdm]);

  // Zoom con la rueda del ratón sobre el geo — listener nativo no-pasivo
  // para poder hacer preventDefault() y que no haga scroll de la página.
  useEffect(() => {
    if (estado !== "encontrado") return;
    const el = contenedorRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => clamp(z - e.deltaY * ZOOM_PASO_RUEDA * z, ZOOM_MIN, ZOOM_MAX));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [estado]);

  if (estado === "nada") return null;

  if (estado === "esperando" || estado === "cargando") {
    return (
      <div ref={sentinelRef} className="border-t border-[var(--panel-border-1)] p-3">
        <div
          className="mx-auto animate-pulse rounded bg-[var(--panel-bg-1)]"
          style={{ height: ALTURA_GEO }}
        />
      </div>
    );
  }

  if (!geo) return null;
  const { paths, circles } = contornosASvgPaths(geo);
  if (paths.length === 0 && circles.length === 0) return null;

  const centroActual = centro ?? geoCentroNatural(geo);
  const desplazado = centro !== null;
  const anchoMm = Math.round(geo.bbox.maxX - geo.bbox.minX);
  const altoMm = Math.round(geo.bbox.maxY - geo.bbox.minY);

  const iniciarArrastre = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = contenedorRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const vb = geoViewBox(geo, zoom, 0.08, centroActual).split(" ").map(Number);
    arrastreRef.current = {
      x: e.clientX,
      y: e.clientY,
      centroInicial: centroActual,
      vbAncho: vb[2] ?? 1,
      vbAlto: vb[3] ?? 1,
    };
    setArrastrando(true);
  };

  const moverArrastre = (e: React.PointerEvent<SVGSVGElement>) => {
    const inicio = arrastreRef.current;
    const rect = contenedorRef.current?.getBoundingClientRect();
    if (!inicio || !rect || rect.width === 0 || rect.height === 0) return;
    const dx = ((e.clientX - inicio.x) / rect.width) * inicio.vbAncho;
    const dy = ((e.clientY - inicio.y) / rect.height) * inicio.vbAlto;
    setCentro({ x: inicio.centroInicial.x - dx, y: inicio.centroInicial.y - dy });
  };

  const soltarArrastre = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    arrastreRef.current = null;
    setArrastrando(false);
  };

  return (
    <div className="border-t border-[var(--panel-border-1)] p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--panel-text-5)]">
          Contorn
        </span>
        <span className="text-[10px] text-[var(--panel-text-4)]">
          {anchoMm} × {altoMm} mm
        </span>
      </div>
      <div
        ref={contenedorRef}
        className="relative overflow-hidden rounded bg-[var(--panel-bg-1)]"
        style={{ height: ALTURA_GEO }}
      >
        <svg
          width="100%"
          height="100%"
          viewBox={geoViewBox(geo, zoom, 0.08, centroActual)}
          preserveAspectRatio="xMidYMid meet"
          className="block"
          style={{ cursor: arrastrando ? "grabbing" : "grab", touchAction: "none" }}
          onPointerDown={iniciarArrastre}
          onPointerMove={moverArrastre}
          onPointerUp={soltarArrastre}
          onPointerCancel={soltarArrastre}
        >
          <title>{archivo}</title>
          {paths.map((d, i) => (
            <path
              key={`p${i}`}
              d={d}
              fill="none"
              stroke="var(--geo-stroke)"
              strokeWidth={1.25}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {circles.map((c, i) => (
            <circle
              key={`c${i}`}
              cx={c.cx}
              cy={c.cy}
              r={c.r}
              fill="none"
              stroke="var(--geo-stroke)"
              strokeWidth={1.25}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>

        {/* Reset — solo si se ha hecho zoom o se ha arrastrado la pieza */}
        {(zoom !== 1 || desplazado) && (
          <button
            type="button"
            title="Restablir vista"
            onClick={() => {
              setZoom(1);
              setCentro(null);
            }}
            className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded border border-[var(--panel-border-1)] bg-[var(--panel-bg-2)]/90 text-[var(--panel-text-3)] transition-colors hover:text-[var(--panel-text-1)]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
