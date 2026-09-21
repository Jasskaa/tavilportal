import type { UserConfig } from "./userConfig";

/**
 * Cada PC corre la seva pròpia instal·lació completa (Servidor a port 8080
 * + Web a port 3000), independent de les altres — cadascú amb el seu propi
 * correu/portal/rutes. Per això el backend a contactar és sempre el de LA
 * MATEIXA màquina que serveix aquesta pàgina (window.location.hostname),
 * mai una IP fixa — una IP fixa faria que totes les instal·lacions
 * acabessin trucant al backend d'un únic PC en comptes del propi.
 */
const BASE = `http://${typeof window !== "undefined" ? window.location.hostname : "localhost"}:8080`;

/** Una diferencia detectada por el comparador de plànols — ver
 * comparar_planols() en el servidor. `bbox` no viaja al frontend (solo se
 * usa para dibujar las marcas en el PDF, en el propio servidor). */
export interface DiferenciaPlanol {
  tipo: "cambiat" | "nou" | "eliminat" | "vista_3d";
  valor_anterior?: string;
  valor_nou?: string;
  descripcio?: string;
}

export interface PiezaResult {
  file: string;
  status: "nueva" | "duplicado";
  ref: string;
  refCliente: string;
  desc: string;
  tract: string;
  grosor: string;
  comanda: string;
  excelEncontrado: boolean;
  tiene_excel: boolean;
  /** Comparador de plànols: null/undefined = no había versió anterior amb
   * qui comparar (no mostrar res); false = comparat, sense diferències;
   * true = comparat, amb diferències. */
  tiene_diferencias?: boolean | null;
  num_diferencias?: number;
  pdf_diferencias?: string;
  diferencias?: DiferenciaPlanol[];
}

export interface DescargaResponse {
  ok: boolean;
  piezas: PiezaResult[];
  duplicados: string[];
  errores: string[];
}

export interface ColaEstado {
  procesando: boolean;
  cola: string[];
  comanda_actual: string;
  fase_actual: string;
  hay_nuevas: boolean;
  piezas_listas: PiezaResult[];
  comandas_listas: string[];
  errores_recientes: string[];
  deteccio_activa: boolean;
}

export async function getColaEstado(): Promise<ColaEstado> {
  const res = await fetch(`${BASE}/cola-estado`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Error: ${res.status}`);
  return res.json();
}

/** "Detectar correus en segon pla" (Ajustos > Impressora) -- NOMÉS afecta
 * aquest PC (cada instal·lació té el seu propi correu/cua). No es guarda
 * al navegador: viu al servidor, per això es llegeix/desa via API. */
export async function getDeteccioCorreu(): Promise<{ activa: boolean }> {
  const res = await fetch(`${BASE}/config/deteccio-correu`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(await extraerMensajeError(res));
  return res.json();
}

export async function setDeteccioCorreu(activa: boolean): Promise<{ ok: boolean; activa: boolean }> {
  const res = await fetch(`${BASE}/config/deteccio-correu`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ activa }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(await extraerMensajeError(res));
  return res.json();
}

export async function limpiarPiezasListas(): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}/limpiar-piezas-listas`, {
    method: "POST",
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Error: ${res.status}`);
  return res.json();
}

export async function limpiarErrores(): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}/limpiar-errores`, {
    method: "POST",
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Error: ${res.status}`);
  return res.json();
}

async function extraerMensajeError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (data?.detail) return data.detail;
  } catch {
    /* la respuesta de error no era JSON */
  }
  return `Error ${res.status}`;
}

export interface ImprimirPlanolResponse {
  ok: boolean;
  file: string;
}

export async function imprimirPlanol(
  comanda: string,
  file: string,
  impresora?: string,
  config?: UserConfig,
): Promise<ImprimirPlanolResponse> {
  const res = await fetch(
    `${BASE}/imprimir-planol/${encodeURIComponent(comanda)}/${encodeURIComponent(file)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ impresora: impresora || null, ruta_comercial: config?.rutaComercial || null }),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!res.ok) throw new Error(await extraerMensajeError(res));
  return res.json();
}

export interface ImprimirTodoResponse {
  ok: boolean;
  enviados: string[];
  total: number;
}

export async function imprimirTodo(comanda: string, impresora?: string, config?: UserConfig): Promise<ImprimirTodoResponse> {
  const res = await fetch(`${BASE}/imprimir-todo/${encodeURIComponent(comanda)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ impresora: impresora || null, ruta_comercial: config?.rutaComercial || null }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(await extraerMensajeError(res));
  return res.json();
}

/**
 * Descarga un fichero via fetch + blob en vez de navegar con un <a href>.
 * Un <a> que apunta a una URL cruzada que devuelve 404 saca al usuario de
 * la SPA entera (navega la pestaña a la respuesta de error) — con fetch
 * el error se captura y se puede mostrar en la propia tarjeta.
 */
async function descargarArchivo(url: string, nombreSugerido: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(await extraerMensajeError(res));

  const blob = await res.blob();
  let nombre = nombreSugerido;
  const disposition = res.headers.get("Content-Disposition");
  const match = disposition?.match(/filename="?([^"]+)"?/);
  if (match?.[1]) nombre = match[1];

  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

export async function descargarPlanol(comanda: string, file: string, config?: UserConfig): Promise<void> {
  const qs = config?.rutaComercial ? `?ruta=${encodeURIComponent(config.rutaComercial)}` : "";
  await descargarArchivo(
    `${BASE}/descargar-planol/${encodeURIComponent(comanda)}/${encodeURIComponent(file)}${qs}`,
    file,
  );
}

/** Comparador de plànols — ver GET /planol-diferencies/{comanda}/{nombre}. */
export function urlPlanolDiferencias(comanda: string, nombreArchivo: string, config?: UserConfig): string {
  const qs = config?.rutaComercial ? `?ruta=${encodeURIComponent(config.rutaComercial)}` : "";
  return `${BASE}/planol-diferencies/${encodeURIComponent(comanda)}/${encodeURIComponent(nombreArchivo)}${qs}`;
}

export async function descargarPlanolDiferencias(comanda: string, nombreArchivo: string, config?: UserConfig): Promise<void> {
  await descargarArchivo(urlPlanolDiferencias(comanda, nombreArchivo, config), nombreArchivo);
}

export async function descargarTodo(comanda: string, config?: UserConfig): Promise<void> {
  const qs = config?.rutaComercial ? `?ruta=${encodeURIComponent(config.rutaComercial)}` : "";
  await descargarArchivo(
    `${BASE}/descargar-todo/${encodeURIComponent(comanda)}${qs}`,
    `${comanda}_comercial.zip`,
  );
}

export interface RefrescarPiezaResponse {
  ok: boolean;
  encontrado: boolean;
  ref?: string;
  refCliente?: string;
  desc?: string;
  tract?: string;
  grosor?: string;
}

export async function refrescarPieza(codigoPieza: string): Promise<RefrescarPiezaResponse> {
  const res = await fetch(`${BASE}/refresh-pieza/${encodeURIComponent(codigoPieza)}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Error: ${res.status}`);
  return res.json();
}

export async function descargarComandas(comandas: string[]): Promise<DescargaResponse> {
  const res = await fetch(`${BASE}/descargar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ comandas }),
  });
  if (!res.ok) throw new Error(`Error del servidor: ${res.status}`);
  return res.json();
}

export async function abrirEnSolidworks(file: string, factor_k: number, codigo_pdm?: string) {
  const res = await fetch(`${BASE}/abrir-solidworks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file, factor_k, codigo_pdm: codigo_pdm ?? "" }),
  });
  if (!res.ok) throw new Error(`Error al abrir SolidWorks: ${res.status}`);
  return res.json();
}

export async function procesarTodas(
  piezas: { file: string; factor_k: number; codigo_pdm?: string }[],
) {
  const res = await fetch(`${BASE}/procesar-todas`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(piezas),
  });
  if (!res.ok) throw new Error(`Error al procesar: ${res.status}`);
  return res.json();
}

export async function checkEmail(): Promise<{ codigos: string[]; total: number }> {
  const res = await fetch(`${BASE}/check-email`, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Error al consultar email: ${res.status}`);
  return res.json();
}

export async function getComandasPendientes(): Promise<{ codigos: string[] }> {
  const res = await fetch(`${BASE}/comandas-pendientes`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Error: ${res.status}`);
  return res.json();
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function getAutoEstado(): Promise<{
  activo: boolean;
  comanda: string;
  fase: string;
  piezas: PiezaResult[];
  errores: string[];
}> {
  const res = await fetch(`${BASE}/auto-estado`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Error: ${res.status}`);
  return res.json();
}

export interface PiezaHistorial extends PiezaResult {
  id: string;
  estado: "pendiente" | "ok";
  fecha: string;
}

export async function getHistorial(): Promise<{ piezas: PiezaHistorial[] }> {
  const res = await fetch(`${BASE}/historial`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Error: ${res.status}`);
  return res.json();
}

export async function marcarPiezaOk(id: string, estado: "ok" | "pendiente"): Promise<void> {
  try {
    await fetch(`${BASE}/historial/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    /* silencio */
  }
}

export async function limpiarHistorialOk(): Promise<void> {
  try {
    await fetch(`${BASE}/historial`, { method: "DELETE", signal: AbortSignal.timeout(5000) });
  } catch {
    /* silencio */
  }
}

// =====================================================================
// BUSCADOR DE PIEZAS — índice construido a partir de todos los Excels de
// costos (no del historial de descargas: cualquier pieza que tenga Excel,
// se haya descargado alguna vez con esta herramienta o no).
// =====================================================================

export interface PiezaIndice {
  codigoCliente: string;
  codigoPdm: string;
  refCliente: string;
  desc: string;
  tract: string;
  grosor: string;
  planolCliente: boolean;
  planolTaller: boolean;
  excelDisponible: boolean;
}

export interface BuscarPiezasParams {
  q?: string;
  tractament?: string;
  grosor?: string;
  codigoPdm?: string;
  codigoCliente?: string;
}

export interface BuscarPiezasResponse {
  resultados: PiezaIndice[];
  total: number;
}

export async function buscarPiezas(params: BuscarPiezasParams, config?: UserConfig): Promise<BuscarPiezasResponse> {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.tractament) qs.set("tractament", params.tractament);
  if (params.grosor) qs.set("grosor", params.grosor);
  if (params.codigoPdm) qs.set("codigo_pdm", params.codigoPdm);
  if (params.codigoCliente) qs.set("codigo_cliente", params.codigoCliente);
  if (config?.rutaExcels) qs.set("ruta_excels", config.rutaExcels);
  if (config?.rutaPlanolsFabricacio) qs.set("ruta_planols_fabricacio", config.rutaPlanolsFabricacio);
  if (config?.rutaPlanolsTaller) qs.set("ruta_planols_taller", config.rutaPlanolsTaller);
  const res = await fetch(`${BASE}/buscar?${qs}`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(await extraerMensajeError(res));
  const data: BuscarPiezasResponse = await res.json();
  // El índice de piezas se construye leyendo los Excels de costos — si una
  // pieza aparece aquí es porque su Excel existe, así que siempre está
  // disponible (a diferencia de una pieza recién descargada, donde el
  // Excel puede no haberse creado todavía — ver piezaResultAIndice).
  return { ...data, resultados: data.resultados.map((p) => ({ ...p, excelDisponible: true })) };
}

export interface FiltrosDisponibles {
  tractaments: string[];
  grosores: string[];
}

export async function getFiltrosDisponibles(config?: UserConfig): Promise<FiltrosDisponibles> {
  const qs = config?.rutaExcels ? `?ruta_excels=${encodeURIComponent(config.rutaExcels)}` : "";
  const res = await fetch(`${BASE}/filtros-disponibles${qs}`, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(await extraerMensajeError(res));
  return res.json();
}

export async function reindexar(config?: UserConfig): Promise<{ ok: boolean; estado: string; total?: number }> {
  const qs = config?.rutaExcels ? `?ruta_excels=${encodeURIComponent(config.rutaExcels)}` : "";
  const res = await fetch(`${BASE}/reindexar${qs}`, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(await extraerMensajeError(res));
  return res.json();
}

export interface IndiceEstado {
  indexando: boolean;
  total: number;
  ultimo_indexado: string;
}

/** Estat NOMÉS-lectura de l'índex (no en dispara cap reindexat) — es fa
 * servir per fer polling després de prémer "Actualitzar índex" i saber
 * quan el reindexat disparat amb reindexar() ha acabat. */
export async function getIndiceEstado(): Promise<IndiceEstado> {
  const res = await fetch(`${BASE}/indice-estado`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(await extraerMensajeError(res));
  return res.json();
}

// =====================================================================
// ARCHIVOS DEL PORTAL — Plànol client / Plànol taller / Excel
//
// Estos tres devuelven directamente la URL del archivo (GET + FileResponse
// en el servidor) para que el propio botón haga window.open(url, "_blank")
// y sea el NAVEGADOR DEL USUARIO quien descargue/abra el archivo.
//
// Antes estos endpoints eran POST + os.startfile() en el servidor — pero
// el servidor corre como servicio Windows en el PC que lo aloja, así que
// os.startfile() abría el archivo ahí, no en el PC de quien pulsaba el
// botón. Con GET + FileResponse el archivo viaja por HTTP hasta el
// navegador del usuario, que es quien de verdad lo abre en su PC.
// =====================================================================

export function urlArchivoPlanolCliente(codigoCliente: string, config?: UserConfig): string {
  const qs = config?.rutaPlanolsFabricacio ? `?ruta=${encodeURIComponent(config.rutaPlanolsFabricacio)}` : "";
  return `${BASE}/archivo-planol-cliente/${encodeURIComponent(codigoCliente)}${qs}`;
}

export function urlArchivoPlanolTaller(codigoPdm: string, config?: UserConfig): string {
  const qs = config?.rutaPlanolsTaller ? `?ruta=${encodeURIComponent(config.rutaPlanolsTaller)}` : "";
  return `${BASE}/archivo-planol-taller/${encodeURIComponent(codigoPdm)}${qs}`;
}

export function urlArchivoExcel(codigo: string, config?: UserConfig): string {
  const qs = config?.rutaExcels ? `?ruta=${encodeURIComponent(config.rutaExcels)}` : "";
  return `${BASE}/archivo-excel/${encodeURIComponent(codigo)}${qs}`;
}

// =====================================================================
// PREVISUALIZACIÓN DE GEO — el servidor devuelve el .geo en crudo (texto),
// el parseo y el renderizado SVG los hace el frontend (ver geoParser.ts).
// =====================================================================

export interface GeoResponse {
  encontrado: boolean;
  contenido?: string;
  archivo?: string;
}

export async function getGeo(codigoPdm: string, config?: UserConfig): Promise<GeoResponse> {
  const qs = config?.rutaPlanolsFabricacio ? `?ruta=${encodeURIComponent(config.rutaPlanolsFabricacio)}` : "";
  const res = await fetch(`${BASE}/geo/${encodeURIComponent(codigoPdm)}${qs}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(await extraerMensajeError(res));
  return res.json();
}

// =====================================================================
// IMPRESIÓN DE DOCUMENTOS TRAS DESCARGAR UNA COMANDA
// =====================================================================

export interface ImprimirComandaResponse {
  ok: boolean;
  comanda: string;
  impresos: number;
  total: number;
}

export async function imprimirComanda(comanda: string, impresora?: string, config?: UserConfig): Promise<ImprimirComandaResponse> {
  const res = await fetch(`${BASE}/imprimir-comanda/${encodeURIComponent(comanda)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ impresora: impresora || null, ruta_comercial: config?.rutaComercial || null }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(await extraerMensajeError(res));
  return res.json();
}

// =====================================================================
// AJUSTOS — impresora preferida por PC (guardada en localStorage, cada
// PC/navegador recuerda la suya; el servidor la usa tal cual al imprimir).
// =====================================================================

const IMPRESORA_STORAGE_KEY = "impresora_preferida";

export function getImpresoraPreferida(): string {
  try {
    return localStorage.getItem(IMPRESORA_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setImpresoraPreferida(nombre: string): void {
  try {
    localStorage.setItem(IMPRESORA_STORAGE_KEY, nombre);
  } catch {
    /* silencio */
  }
}

export interface ImpresorasResponse {
  ok: boolean;
  impresoras: string[];
  metodo?: string | null;
}

/** Lista de impresoras instaladas en el PC servidor — se elige una en
 * Ajustos y se guarda localmente en este PC/navegador. */
export async function getImpresoras(): Promise<ImpresorasResponse> {
  const res = await fetch(`${BASE}/impresoras`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(await extraerMensajeError(res));
  return res.json();
}

// =====================================================================
// ANULADOR — réplica web de ANULAR PLANOLS/planols.py y ANULAR GEOS/anular.py
// =====================================================================

export type AnuladorEstado = "anular" | "correcte";

export interface AnuladorItemPlanol {
  base_id: string;
  ext: string;
  revision: number;
  revision_activa: number;
  archivo_actual: string;
  archivo_nuevo: string;
  estado: AnuladorEstado;
}

export interface AnuladorItemGeo {
  codigo: string;
  version: number;
  version_activa: number;
  archivo_actual: string;
  archivo_nuevo: string;
  estado: AnuladorEstado;
}

/** Un "programa" TruBend puede tener 1 o 2 archivos (.bmt y/o .jupidu,
 * no siempre ambos existen) y viene de una de las dos máquinas. */
export interface AnuladorItemPrograma {
  codigo: string;
  version: number;
  version_activa: number;
  archivos: string[];
  archivos_nuevos: string[];
  carpeta: "5085" | "5230";
  estado: AnuladorEstado;
}

export interface AnuladorListaResponse<T> {
  ok: boolean;
  items: T[];
  total: number;
  /** Carpetas que no se han podido leer (no existe / no accesible) — solo
   * en /anulador/programes, ya que sus dos rutas son unidades de red que
   * pueden no estar disponibles. */
  errores?: string[];
}

export interface AnuladorEjecutarResponse {
  ok: boolean;
  anulados: number;
  total: number;
  errores: string[];
}

export async function getAnuladorPlanols(): Promise<AnuladorListaResponse<AnuladorItemPlanol>> {
  const res = await fetch(`${BASE}/anulador/planols`, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(await extraerMensajeError(res));
  return res.json();
}

export async function getAnuladorGeos(): Promise<AnuladorListaResponse<AnuladorItemGeo>> {
  const res = await fetch(`${BASE}/anulador/geos`, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(await extraerMensajeError(res));
  return res.json();
}

export async function ejecutarAnuladorPlanols(): Promise<AnuladorEjecutarResponse> {
  const res = await fetch(`${BASE}/anulador/ejecutar-planols`, {
    method: "POST",
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(await extraerMensajeError(res));
  return res.json();
}

export async function ejecutarAnuladorGeos(): Promise<AnuladorEjecutarResponse> {
  const res = await fetch(`${BASE}/anulador/ejecutar-geos`, {
    method: "POST",
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(await extraerMensajeError(res));
  return res.json();
}

export async function getAnuladorProgrames(): Promise<AnuladorListaResponse<AnuladorItemPrograma>> {
  const res = await fetch(`${BASE}/anulador/programes`, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(await extraerMensajeError(res));
  return res.json();
}

export async function ejecutarAnuladorProgrames(): Promise<AnuladorEjecutarResponse> {
  const res = await fetch(`${BASE}/anulador/ejecutar-programes`, {
    method: "POST",
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(await extraerMensajeError(res));
  return res.json();
}

// =====================================================================
// ENTORN DE PROVES — simula la macro VBA d'Outlook des del navegador:
// puja el PDF adjunt (que viu al PC de qui prova, no al servidor) i
// després crida a POST /auto-descargar exactament igual que ho fa la
// macro real, sense cap camí especial al servidor.
// =====================================================================

export interface LogEntry {
  ts: string;
  tipo: "INFO" | "OK" | "ERROR" | "STEP" | "FILE" | "PRINT" | "COMPARE" | "WAIT" | "PING";
  msg: string;
}

/** URL del stream SSE del log en temps real — GET /log-stream. */
export function urlLogStream(): string {
  return `${BASE}/log-stream`;
}

export async function subirPdfCorreoTest(file: File): Promise<{ ok: boolean; ruta: string; nombre: string }> {
  const form = new FormData();
  form.append("archivo", file);
  const res = await fetch(`${BASE}/test/subir-pdf-correo`, { method: "POST", body: form });
  if (!res.ok) throw new Error(await extraerMensajeError(res));
  return res.json();
}

export async function simularAutoDescargar(
  comanda: string,
  pdfCorreo: string,
  accion: "imprimir" | "descarregar" = "imprimir",
): Promise<{ ok: boolean; msg: string; cola: number }> {
  const res = await fetch(`${BASE}/auto-descargar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // El servidor solo distingue "imprimir"/"descargar" (castellano) — se
    // traduce aquí para no filtrar la palabra catalana al contrato HTTP.
    body: JSON.stringify({ comanda, pdf_correo: pdfCorreo, accion: accion === "descarregar" ? "descargar" : "imprimir" }),
  });
  if (!res.ok) throw new Error(await extraerMensajeError(res));
  return res.json();
}

/** Recoge el ZIP que dejó preparado el flujo automático cuando el toggle
 * de Ajustos estaba en "descarregar" — GET /descarga-pendiente/{comanda}.
 * Se puede recoger una sola vez (el servidor lo retira al servirlo). */
export async function descargarPendiente(comanda: string): Promise<void> {
  await descargarArchivo(`${BASE}/descarga-pendiente/${encodeURIComponent(comanda)}`, `${comanda}_documents.zip`);
}
