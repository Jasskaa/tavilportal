/**
 * Parser de archivos .geo (formato TRUMPF TruTops) para previsualizar el
 * contorno de una pieza de chapa metálica en el buscador de piezas.
 *
 * Formato real (analizado sobre archivos de producción de
 * \\SRVDADES\dades domoli\Fabricacio\PLANOLS\1076, no asumido):
 *
 *   #~31                          <- tabla de puntos
 *   P
 *   <id entero>
 *   <x> <y> <z>
 *   |~
 *   ... (se repite un bloque P/id/coords/|~ por punto)
 *   ##~~
 *
 *   #~33                          <- inicio de un contorno (se repite, 1 por contorno)
 *   <línea en blanco>
 *   <id_contorno> <tipo=24> <flag>   <- flag 0 = contorno exterior, 1 = agujero/hueco
 *   <count>
 *   <nx> <ny> <nz>                   <- normal
 *   <minx> <miny> <minz>             <- bbox del contorno
 *   <maxx> <maxy> <maxz>
 *   <cx> <cy> <cz>                   <- centro
 *   <perímetro>
 *   <flag2>
 *   ##~~
 *   #~331                            <- segmentos del contorno
 *   LIN / ARC / CIR
 *   <flags>
 *   <datos según tipo>
 *   |~
 *   ... (se repite un segmento por línea/arco/círculo)
 *   ##~~
 *   #~KONT_END
 *
 * Segmentos, confirmados con las coordenadas reales de la tabla de puntos:
 *   LIN <p1> <p2>                    -> línea recta entre esos dos puntos
 *   ARC <centro> <inicio> <fin>      -> arco circular (comprobado: dist(centro,inicio) == dist(centro,fin))
 *       <dirección +1/-1>
 *   CIR <centro>                     -> círculo completo (agujero)
 *       <radio>
 */

export interface PuntoGeo {
  x: number;
  y: number;
}

export type SegmentoGeo =
  | { tipo: "linea"; p1: PuntoGeo; p2: PuntoGeo }
  | { tipo: "arc"; centro: PuntoGeo; inicio: PuntoGeo; fin: PuntoGeo }
  | { tipo: "circulo"; centro: PuntoGeo; radio: number };

export interface ContornoGeo {
  esExterior: boolean;
  segmentos: SegmentoGeo[];
}

export interface GeoParseado {
  contornos: ContornoGeo[];
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

/** Línea `i` del array, o "" si está fuera de rango — evita el ruido de
 * `string | undefined` de noUncheckedIndexedAccess en todo el parser. */
function linea(lineas: string[], i: number): string {
  return (lineas[i] ?? "").trim();
}

function parsearNumeros(texto: string): number[] {
  return texto
    .trim()
    .split(/\s+/)
    .filter((s) => s.length > 0)
    .map(Number);
}

function num(nums: number[], i: number): number {
  return nums[i] ?? NaN;
}

/**
 * Parsea el contenido en crudo de un .geo. Devuelve null si el formato no
 * encaja (para no mostrar nada en la tarjeta en vez de romper) — nunca
 * lanza una excepción hacia fuera.
 */
export function parseGeo(contenido: string): GeoParseado | null {
  try {
    const lineas = contenido.split(/\r?\n/);

    // --- 1) Tabla de puntos (#~31) ---
    const puntos = new Map<number, PuntoGeo>();
    let i = lineas.findIndex((l) => l.trim() === "#~31");
    if (i === -1) return null;
    i++;
    while (i < lineas.length && linea(lineas, i) !== "##~~") {
      if (linea(lineas, i) === "P") {
        const id = parseInt(linea(lineas, i + 1), 10);
        const coords = parsearNumeros(linea(lineas, i + 2));
        const x = num(coords, 0);
        const y = num(coords, 1);
        if (!Number.isNaN(id) && Number.isFinite(x) && Number.isFinite(y)) {
          puntos.set(id, { x, y });
        }
        i += 4; // P / id / coords / |~
      } else {
        i++;
      }
    }
    if (puntos.size === 0) return null;

    // --- 2) Contornos (#~33 ... #~KONT_END) ---
    const contornos: ContornoGeo[] = [];
    while (i < lineas.length) {
      if (linea(lineas, i) !== "#~33") {
        i++;
        continue;
      }
      let j = i + 1;
      while (j < lineas.length && linea(lineas, j) === "") j++;
      const cabecera = parsearNumeros(linea(lineas, j));
      const esExterior = num(cabecera, 2) === 0;

      while (j < lineas.length && linea(lineas, j) !== "#~331") j++;
      j++;

      const segmentos: SegmentoGeo[] = [];
      while (j < lineas.length && linea(lineas, j) !== "##~~") {
        const tipo = linea(lineas, j);
        if (tipo === "LIN" || tipo === "ARC" || tipo === "CIR") {
          const datos: string[] = [];
          let k = j + 1;
          while (k < lineas.length && linea(lineas, k) !== "|~") {
            datos.push(linea(lineas, k));
            k++;
          }
          if (tipo === "LIN" && datos.length >= 2) {
            const ids = parsearNumeros(datos[1] ?? "");
            const p1 = puntos.get(num(ids, 0));
            const p2 = puntos.get(num(ids, 1));
            if (p1 && p2) segmentos.push({ tipo: "linea", p1, p2 });
          } else if (tipo === "ARC" && datos.length >= 2) {
            const ids = parsearNumeros(datos[1] ?? "");
            const centro = puntos.get(num(ids, 0));
            const inicio = puntos.get(num(ids, 1));
            const fin = puntos.get(num(ids, 2));
            if (centro && inicio && fin) segmentos.push({ tipo: "arc", centro, inicio, fin });
          } else if (tipo === "CIR" && datos.length >= 3) {
            const idsCentro = parsearNumeros(datos[1] ?? "");
            const radio = num(parsearNumeros(datos[2] ?? ""), 0);
            const centro = puntos.get(num(idsCentro, 0));
            if (centro && Number.isFinite(radio) && radio > 0) {
              segmentos.push({ tipo: "circulo", centro, radio });
            }
          }
          j = k + 1; // saltar el "|~"
        } else {
          j++;
        }
      }

      if (segmentos.length > 0) contornos.push({ esExterior, segmentos });
      i = j;
    }

    if (contornos.length === 0) return null;

    // --- 3) Bounding box a partir de los puntos realmente usados ---
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const acumular = (p: PuntoGeo) => {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    };
    for (const c of contornos) {
      for (const s of c.segmentos) {
        if (s.tipo === "linea") {
          acumular(s.p1);
          acumular(s.p2);
        } else if (s.tipo === "arc") {
          acumular(s.centro);
          acumular(s.inicio);
          acumular(s.fin);
        } else {
          acumular({ x: s.centro.x - s.radio, y: s.centro.y - s.radio });
          acumular({ x: s.centro.x + s.radio, y: s.centro.y + s.radio });
        }
      }
    }
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
    if (maxX - minX <= 0 || maxY - minY <= 0) return null;

    return { contornos, bbox: { minX, minY, maxX, maxY } };
  } catch {
    return null;
  }
}

export interface SvgContornos {
  paths: string[];
  circles: { cx: number; cy: number; r: number }[];
}

/**
 * Convierte los contornos parseados a comandos de SVG (paths para
 * líneas+arcos, circle para agujeros circulares "sueltos"), en las
 * coordenadas ORIGINALES del .geo salvo invertir Y (los .geo usan Y hacia
 * arriba como un DXF; SVG usa Y hacia abajo) — sin escalar a píxeles: es
 * el `viewBox` del `<svg>` (ver geoViewBox) el que hace el ajuste al
 * contenedor, lo que permite hacer zoom cambiando solo el viewBox.
 */
export function contornosASvgPaths(geo: GeoParseado): SvgContornos {
  const t = (p: PuntoGeo) => ({ x: p.x, y: -p.y });

  const paths: string[] = [];
  const circles: { cx: number; cy: number; r: number }[] = [];

  for (const contorno of geo.contornos) {
    const unico = contorno.segmentos.length === 1 ? contorno.segmentos[0] : undefined;
    // Un contorno formado por un único CIR es un agujero circular -> <circle>
    if (unico && unico.tipo === "circulo") {
      const c = t(unico.centro);
      circles.push({ cx: c.x, cy: c.y, r: unico.radio });
      continue;
    }

    let d = "";
    let iniciado = false;
    for (const seg of contorno.segmentos) {
      if (seg.tipo === "linea") {
        const a = t(seg.p1);
        const b = t(seg.p2);
        if (!iniciado) {
          d += `M ${a.x.toFixed(3)} ${a.y.toFixed(3)} `;
          iniciado = true;
        }
        d += `L ${b.x.toFixed(3)} ${b.y.toFixed(3)} `;
      } else if (seg.tipo === "arc") {
        const centro = t(seg.centro);
        const inicio = t(seg.inicio);
        const fin = t(seg.fin);
        const radio = Math.hypot(inicio.x - centro.x, inicio.y - centro.y);
        if (radio <= 0) continue;
        // Sentido de giro (sweep-flag SVG) a partir del signo del producto
        // vectorial inicio->centro / fin->centro, ya en espacio SVG (Y ya
        // invertida arriba).
        const cross =
          (inicio.x - centro.x) * (fin.y - centro.y) - (inicio.y - centro.y) * (fin.x - centro.x);
        const sweepFlag = cross > 0 ? 1 : 0;
        const anguloInicio = Math.atan2(inicio.y - centro.y, inicio.x - centro.x);
        const anguloFin = Math.atan2(fin.y - centro.y, fin.x - centro.x);
        let delta = sweepFlag === 1 ? anguloFin - anguloInicio : anguloInicio - anguloFin;
        delta = ((delta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const largeArcFlag = delta > Math.PI ? 1 : 0;
        if (!iniciado) {
          d += `M ${inicio.x.toFixed(3)} ${inicio.y.toFixed(3)} `;
          iniciado = true;
        }
        d += `A ${radio.toFixed(3)} ${radio.toFixed(3)} 0 ${largeArcFlag} ${sweepFlag} ${fin.x.toFixed(3)} ${fin.y.toFixed(3)} `;
      } else {
        const c = t(seg.centro);
        circles.push({ cx: c.x, cy: c.y, r: seg.radio });
      }
    }
    if (iniciado) {
      paths.push(`${d}Z`);
    }
  }

  return { paths, circles };
}

/** Centro natural del contorno (en el mismo espacio Y-invertida que usa
 * contornosASvgPaths/geoViewBox) — el que se usa por defecto y al resetear
 * después de arrastrar. */
export function geoCentroNatural(geo: GeoParseado): { x: number; y: number } {
  const { minX, minY, maxX, maxY } = geo.bbox;
  return { x: minX + (maxX - minX) / 2, y: -(minY + (maxY - minY) / 2) };
}

/**
 * ViewBox que encuadra el contorno completo con un margen proporcional al
 * tamaño de la pieza (en vez de píxeles fijos, que no tienen sentido aquí:
 * las piezas van de pocos mm a más de un metro). `factorZoom` > 1 acerca
 * (recorta el viewBox manteniendo el centro); se usa para el zoom in/out.
 * `centro` opcional permite desplazar la vista (arrastrar la pieza) — si
 * no se pasa, se centra en el propio contorno.
 */
export function geoViewBox(
  geo: GeoParseado,
  factorZoom = 1,
  margenFrac = 0.08,
  centro?: { x: number; y: number },
): string {
  const { minX, minY, maxX, maxY } = geo.bbox;
  const anchoDatos = maxX - minX;
  const altoDatos = maxY - minY;
  const margen = Math.max(anchoDatos, altoDatos) * margenFrac;
  const anchoBase = anchoDatos + margen * 2;
  const altoBase = altoDatos + margen * 2;
  const { x: centroX, y: centroY } = centro ?? geoCentroNatural(geo);

  const ancho = anchoBase / factorZoom;
  const alto = altoBase / factorZoom;

  return `${(centroX - ancho / 2).toFixed(3)} ${(centroY - alto / 2).toFixed(3)} ${ancho.toFixed(3)} ${alto.toFixed(3)}`;
}
