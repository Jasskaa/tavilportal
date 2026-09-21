"""
Orquestador 1076 · Tavil — Servidor FastAPI
Corre en el PC principal con acceso a \\SRVDADES\\dades domoli y SolidWorks.
Arrancar con:  uvicorn main:app --host 0.0.0.0 --port 8000 --reload
"""

import os
import re
import io
import time
import contextlib
import shutil
import zipfile
import asyncio
import base64
import json
import logging
import subprocess
import traceback
import unicodedata
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Optional
from datetime import datetime, timedelta, timezone

import openpyxl
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel
from playwright.sync_api import sync_playwright
import pymupdf as fitz  # el nombre "fitz" es el legacy; "pymupdf" es el paquete actual
from PIL import Image
from dotenv import load_dotenv

load_dotenv()


# =====================================================================
# CONFIGURACIÓN
# =====================================================================
# NOTA: se usan rutas UNC (\\SRVDADES\...) en vez de la unidad P:\ porque
# el servidor corre como servicio Windows (LocalSystem). Las unidades de
# red mapeadas con "net use" (P:\, M:\, etc.) sólo existen en la sesión
# interactiva del usuario que las mapeó (aislamiento de Sesión 0) y son
# invisibles para un servicio — con P:\ el servicio no encuentra nada.
CARPETA_RAIZ_1076   = r"\\SRVDADES\dades domoli\Fabricacio\PLANOLS\1076"
CARPETA_TEMPORAL    = os.path.join(CARPETA_RAIZ_1076, "_TEMP")
# _DUPLICADOS ya no se usa: cualquier archivo con nombre repetido se anula
# (--ANUL·LAT--) y se sustituye, nunca se aparta a una carpeta aparte.
CARPETA_EXCELS      = r"\\SRVDADES\dades domoli\Costos\COSTOS\1076 -- TAVIL"

# =====================================================================
# ESTAT DE L'APLICACIÓ (historial, índex, PDFs de correu, logs) -- viu a
# \\SRVDADES i NO a C:\DXF TEMPORAL (local a cada PC), perquè cada
# comercial/dibuixant té la seva pròpia instal·lació d'aquest servidor
# (amb el seu propi correu i login al portal) però tots han de compartir
# el mateix historial de peces, el mateix índex de cerca i els mateixos
# PDFs entrants -- i perquè els logs quedin tots junts en un sol lloc en
# comptes d'escampats per cada PC. Carpeta pròpia, fora de
# CARPETA_RAIZ_1076/PLANOLS, perquè el buscador/anul·lador no la confonguin
# amb una carpeta de peces.
#
# EXCEPCIÓ deliberada: les credencials (.env) NO viuen aquí -- es queden
# sempre locals a cada PC, mai en una carpeta de xarxa llegible per tothom.
CARPETA_PORTAL_TAVIL = r"\\SRVDADES\dades domoli\Portal Tavil"
CARPETA_LOGS          = os.path.join(CARPETA_PORTAL_TAVIL, "logs")
RUTA_HISTORIAL      = os.path.join(CARPETA_PORTAL_TAVIL, "historial_piezas.json")
RUTA_INDICE_PIEZAS  = os.path.join(CARPETA_PORTAL_TAVIL, "indice_piezas.json")

# NOMÉS aquesta ruta es queda local a propòsit (no a \\SRVDADES com la
# resta): és un handoff amb macros NATIUS de SolidWorks que corren en
# aquest mateix PC (GuardarPieza.swp / Macrosw.swp / automatizacion.py, a
# C:\DXF TEMPORAL\Programacio) i que tenen aquesta ruta local hardcodejada
# -- movent només el costat Python es trencaria l'automatització de
# SolidWorks sense poder actualitzar els macros .swp (binaris) igual.
RUTA_TXT_INTERMEDIO = r"C:\DXF TEMPORAL\MACROS\datos_operacion.txt"
RUTA_TEMP_EXCEL     = os.path.join(CARPETA_PORTAL_TAVIL, "datos_pieza.txt")  # no s'utilitza enlloc actualment
CARPETA_COMERCIAL   = r"\\SRVDADES\dades domoli\Comercial\Tavil"
CARPETA_TALLER      = r"\\SRVDADES\taller\planols taller\1076"  # nuestros plànols, nombrados por codigo PDM (p.ej. 10760000005406.pdf)

# Servidor de archivos permitido para rutas configurables por el usuario
# (ver "CONFIGURACIÓN DE RUTAS POR USUARIO" más abajo) — solo se acepta
# \\SRVDADES\... porque el servicio corre en LocalSystem, expuesto sin
# autenticación a toda la LAN (allow_origins=["*"]): sin esta restricción,
# cualquiera podría hacer que el servidor lea/sirva archivos de fuera de
# vuestros recursos compartidos.
SERVIDOR_UNC_PERMITIDO = "SRVDADES"

# Credencials del portal SharePoint de Tavil -- carregades des de .env (mai
# es pugen a GitHub; veure .env.example al repositori per a la plantilla).
PORTAL_USUARIO      = os.getenv("PORTAL_USUARIO")
PORTAL_CONTRASENYA  = os.getenv("PORTAL_CONTRASENYA")

OUTLOOK_REMITENTES    = ("compresmec@tavil.net", "ot@domoli.com", "jaskaranmr18@gmail.com")
PATRON_CODIGO         = re.compile(r"\b(\d{10})\b")
# Archivo TXT donde la macro VBA de Outlook escribe los asuntos
RUTA_INBOX_TXT        = os.path.join(CARPETA_PORTAL_TAVIL, "inbox_tavil.txt")
RUTA_TEMP_PDF         = os.path.join(CARPETA_PORTAL_TAVIL, "temp_pdf")
# %LOCALAPPDATA% en comptes d'un usuari fixat -- perquè funcioni igual en
# qualsevol PC/usuari on s'instal.li aquest servidor (SumatraPDF s'instal.la
# per defecte a la carpeta LOCALAPPDATA de l'usuari que l'ha instal.lat).
SUMATRA_EXE           = os.path.join(
    os.environ.get("LOCALAPPDATA", r"C:\Windows\System32\config\systemprofile\AppData\Local"),
    "SumatraPDF", "SumatraPDF.exe",
)
IMPRESORA             = "MF750C Series(2)"  # fallback -- normalment se sobreescriu amb la impressora triada a Ajustos
# Tiempo de espera entre PDFs al imprimir varios seguidos — sin esto, lanzar
# los Popen de SumatraPDF uno detrás de otro sin margen hace que el driver/
# spooler de la impresora reciba el siguiente trabajo antes de terminar de
# procesar el anterior, y algunas páginas salen en blanco.
INTERVALO_ENTRE_IMPRESIONES = 5.0

# =====================================================================
# LOGGING — el servicio Windows no tiene consola, así que sin esto los
# print() no se ven en ningún sitio. Queda constancia en servidor.log,
# dins de CARPETA_LOGS (\\SRVDADES\...\Portal Tavil\logs).
# =====================================================================
try:
    os.makedirs(CARPETA_LOGS, exist_ok=True)
    _ruta_log = os.path.join(CARPETA_LOGS, "servidor.log")
except OSError:
    # \\SRVDADES pot trigar uns segons a estar disponible just en arrencar
    # el PC (el servei arrenca abans que la xarxa estigui llesta) -- si
    # encara no hi ha accés, cau a un log local temporal en comptes de fer
    # petar tot el servei (i quedar-se sense CAP constància de per què).
    _ruta_log = r"C:\DXF TEMPORAL\MACROS\servidor_arrencada.log"
    os.makedirs(os.path.dirname(_ruta_log), exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        RotatingFileHandler(
            _ruta_log,
            maxBytes=5_000_000, backupCount=3, encoding="utf-8",
        ),
        logging.StreamHandler(),
    ],
)
log = logging.getLogger("orquestador")
if os.path.dirname(_ruta_log) != CARPETA_LOGS:
    log.warning(f"[Logging] \\\\SRVDADES no accessible en arrencar -- fent servir log local temporal a {_ruta_log}")


# =====================================================================
# LOG EN TIEMPO REAL (SSE) — panel de log del "Entorn de proves" del
# frontend. Se llama a esta función log_sse() (NO log(), que colisionaría
# con el logger estándar de arriba, usado como log.info/log.error/etc. en
# todo el archivo) en cada paso relevante de _hacer_descarga y
# _ejecutar_auto_descarga.
#
# Multi-suscriptor: cada pestaña que abre GET /log-stream registra su
# propia asyncio.Queue en _log_subscribers y log_sse() escribe en TODAS —
# un único asyncio.Queue compartido (tal como se pidió originalmente)
# haría que solo UN cliente conectado recibiera cada mensaje (Queue.get()
# consume el item), y los demás se quedarían sin nada.
#
# Thread-safety: _hacer_descarga corre en un hilo de threadpool (llamada
# vía loop.run_in_executor desde el flujo automático, o directamente por
# FastAPI en su propio threadpool para /descargar), nunca en el hilo del
# event loop — por eso log_sse() usa call_soon_threadsafe en vez de tocar
# las Queue directamente.
# =====================================================================
_log_subscribers: list[asyncio.Queue] = []
_main_loop: Optional[asyncio.AbstractEventLoop] = None


def log_sse(tipo: str, mensaje: str):
    """Emite una línea al panel de log en tiempo real (SSE) de TODOS los
    clientes conectados a /log-stream, y de paso al log de siempre
    (servidor.log) para que quede constancia igualmente ahí."""
    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    entry = {"ts": ts, "tipo": tipo, "msg": mensaje}

    def _difundir():
        for q in list(_log_subscribers):
            try:
                q.put_nowait(entry)
            except Exception:
                pass

    if _main_loop is not None:
        try:
            _main_loop.call_soon_threadsafe(_difundir)
        except Exception:
            pass
    else:
        _difundir()

    log.info(f"[{tipo}] {mensaje}")


# Estado en memoria
_comandas_pendientes: list[str] = []
_comandas_ya_vistas: set[str] = set()

# Cola de comandas a procesar en background
_cola_comandas: list[dict] = []  # [{comanda, pdf_correo}]
_procesando: bool = False

# Interruptor de "detectar correus en segon pla" (Ajustos > Impressora) --
# NOMÉS afecta aquest PC/instal.lació (cada una té el seu propi correu i
# cua). En memòria, no persisteix a disc a propòsit: si es reinicia el
# servei, torna a l'estat per defecte (activat) en comptes de quedar-se
# desactivat en silenci per sempre si algú s'oblida de reactivar-ho.
_deteccio_correu_activa: bool = True

# Piezas acumuladas de todas las comandas procesadas (listas para consultar)
_piezas_listas: list[dict] = []
_comandas_listas: list[str] = []

# Últimos errores de la descarga automática (para mostrar en el ColaBadge)
_errores_recientes: list[str] = []

# ZIPs generados por el flujo automático cuando accio="descargar" (en vez de
# imprimir) — el navegador que esté mirando "Entorn de proves" los recoge
# con GET /descarga-pendiente/{comanda} y se retiran de aquí al servirse.
# Guardamos también la hora de creación para poder purgar los que nadie
# recoja nunca (p.ej. si se cerró la pestaña antes de que terminara) y no
# acumular memoria indefinidamente.
_descargas_pendientes: dict[str, tuple[float, bytes]] = {}
_TTL_DESCARGA_PENDIENTE = 3600.0  # 1h


def _purgar_descargas_pendientes():
    ahora = time.time()
    for comanda in [c for c, (ts, _) in _descargas_pendientes.items() if ahora - ts > _TTL_DESCARGA_PENDIENTE]:
        _descargas_pendientes.pop(comanda, None)

# Índice de piezas construido leyendo TODOS los excels de costos (fila 11
# de cada uno). Se carga desde caché al arrancar (disponible al instante,
# aunque algo desactualizado) y se reconstruye en segundo plano — con
# ~5.000 excels en una unidad de red, reindexar tarda unos 4 minutos, así
# que nunca se hace de forma síncrona dentro de una petición.
_INDICE_PIEZAS: list[dict] = []
_indexando: bool = False
_ultimo_indexado: str = ""

# Caché corta de listados de carpeta — P:\Fabricacio\PLANOLS\1076 tiene
# ~28.000 archivos y es una unidad de red; listarla entera en cada búsqueda
# del portal (que se dispara "en tiempo real" según se escribe) sería
# demasiado lento. Con este TTL una búsqueda mientras se teclea reutiliza
# el mismo listado en vez de volver a golpear la red en cada letra.
_CACHE_LISTADOS: dict[str, tuple[float, list[str]]] = {}
_CACHE_TTL_SEGUNDOS = 20.0

# Estado de la tarea actual
_auto_estado: dict = {"activo": False, "comanda": "", "fase": "", "piezas": [], "errores": [], "log": []}

URL_PORTAL = (
    "https://tavil.sharepoint.com/teams/Domoli/Documents%20compartits/"
    "Forms/AllItems.aspx?id=%2Fteams%2FDomoli%2FDocuments%20compartits"
    "%2FComandes&viewid=e9c40fab%2D5da7%2D410e%2Db22c%2D94081e82a353"
)

EXTENSIONES_STEP      = ('.step', '.stp')
EXTENSIONES_ASOCIADAS = ('.pdf', '.dxf', '.step', '.stp')

# =====================================================================
# APP
# =====================================================================
app = FastAPI(title="Orquestador 1076", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # red local, todos los PCs del taller
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],  # para que el JS pueda leer el nombre real del fichero descargado
)


@app.get("/log-stream")
async def log_stream():
    """SSE del panel de log en tiempo real ("Entorn de proves" del
    frontend) — cada pestaña conectada recibe TODOS los mensajes que emita
    log_sse() mientras esté abierta (ver _log_subscribers arriba)."""
    cola: asyncio.Queue = asyncio.Queue()
    _log_subscribers.append(cola)

    async def generador():
        try:
            saludo = {"ts": datetime.now().strftime("%H:%M:%S.%f")[:-3], "tipo": "INFO", "msg": "Connectat al log"}
            yield f"data: {json.dumps(saludo, ensure_ascii=False)}\n\n"
            while True:
                try:
                    entry = await asyncio.wait_for(cola.get(), timeout=30)
                    yield f"data: {json.dumps(entry, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    yield 'data: {"tipo":"PING","msg":""}\n\n'
        finally:
            try:
                _log_subscribers.remove(cola)
            except ValueError:
                pass

    return StreamingResponse(
        generador(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@app.post("/test/subir-pdf-correo")
async def test_subir_pdf_correo(archivo: UploadFile = File(...)):
    """Solo para el 'Entorn de proves': el PDF adjunto que el usuario elige
    en el navegador vive en SU máquina, no en el servidor — a diferencia de
    la macro real de Outlook, que ya corre en el PC servidor y guarda el
    adjunto directamente en RUTA_TEMP_PDF. Este endpoint sube esos bytes y
    los guarda ahí mismo, para que la ruta resultante sirva tal cual como
    `pdf_correo` en POST /auto-descargar — el resto del flujo (cola,
    _ejecutar_auto_descarga...) es exactamente el mismo que con un correo
    real, no hay ninguna rama especial para el modo de pruebas."""
    if not archivo.filename or not archivo.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Només s'accepten fitxers .pdf")
    os.makedirs(RUTA_TEMP_PDF, exist_ok=True)
    nombre_seguro = os.path.basename(archivo.filename)  # nunca confiar en el path que mande el cliente
    ruta_destino = os.path.join(RUTA_TEMP_PDF, nombre_seguro)
    try:
        contenido = await archivo.read()
        with open(ruta_destino, "wb") as f:
            f.write(contenido)
    except Exception as e:
        raise HTTPException(500, f"Error guardant el PDF: {e}")
    log_sse("FILE", f"[Entorn de proves] PDF adjunt rebut: {nombre_seguro} ({len(contenido):,} bytes)")
    return {"ok": True, "ruta": ruta_destino, "nombre": nombre_seguro}


# =====================================================================
# MODELOS
# =====================================================================
class DescargaRequest(BaseModel):
    comandas: list[str]

class PiezaResult(BaseModel):
    file: str
    status: str          # "nueva" | "duplicado"
    ref: str             # código nuestro (1076-...) o el código de cliente si aún no hay Excel
    refCliente: str      # referencia del cliente (celda B11)
    desc: str
    tract: str
    grosor: str
    comanda: str = ""    # comanda de origen de esta pieza
    excelEncontrado: bool = False  # False = Excel de costos aún no creado
    tiene_excel: bool = False  # idéntico a excelEncontrado — nombre pedido explícitamente
                                # por el frontend para las tarjetas de descarga
    # Comparador de plànols (ver comparar_planols): None = no se pudo/no había
    # nada que comparar (no hay tarjeta de diferencias en el frontend);
    # False = se comparó y no hay diferencias; True = hay diferencias.
    tiene_diferencias: Optional[bool] = None
    num_diferencias: int = 0
    pdf_diferencias: str = ""  # nombre de archivo del PDF de diferencias, vacío si no aplica
    diferencias: list[dict] = []  # [{tipo, valor_anterior?, valor_nou?, descripcio?}] sin bbox — para el panel lateral

class DescargaResponse(BaseModel):
    ok: bool
    piezas: list[PiezaResult]
    duplicados: list[str]
    errores: list[str]

class AbrirRequest(BaseModel):
    file: str
    factor_k: float
    codigo_pdm: Optional[str] = ""

class ImprimirOpcionesRequest(BaseModel):
    """Body opcional de los endpoints de impresión — si no se envía body
    (o se envía sin `impresora`), se usa IMPRESORA como antes. `ruta_comercial`
    es la config personal del usuario (ver CONFIGURACIÓN DE RUTAS POR
    USUARIO); si no viene o no es válida, se usa CARPETA_COMERCIAL."""
    impresora: Optional[str] = None
    ruta_comercial: Optional[str] = None

# =====================================================================
# CONFIGURACIÓN DE RUTAS POR USUARIO
# =====================================================================
# Cada navegador guarda su propia config en localStorage (ver useUserConfig
# en el frontend) y la envía en cada petición que necesita rutas. El
# servidor NUNCA usa una ruta de cliente tal cual: siempre pasa por
# _validar_ruta_config, que solo acepta UNC bajo \\SRVDADES\... (mismo
# servidor que ya usan las rutas hardcodeadas de arriba) y cae al valor
# por defecto si no es válida — un typo del usuario no rompe nada, solo
# vuelve al comportamiento de siempre. Los endpoints que ABREN/EJECUTAN
# archivos en el propio servidor (os.startfile en /abrir-solidworks) NO
# aceptan override: ahí una ruta de cliente sin restringir sería ejecución
# de código arbitraria en el servidor (corre como servicio LocalSystem).
def _validar_ruta_config(ruta: Optional[str], nombre_campo: str, default: str) -> str:
    ruta = (ruta or "").strip().strip('"').replace("/", "\\")
    if not ruta:
        return default
    segmentos = [s for s in ruta.split("\\") if s]
    if ".." in segmentos:
        log.warning(f"[Config] Ruta rechazada para {nombre_campo} (contiene '..'): {ruta!r}")
        return default
    if len(segmentos) < 2 or segmentos[0].upper() != SERVIDOR_UNC_PERMITIDO.upper():
        log.warning(f"[Config] Ruta rechazada para {nombre_campo} (no es UNC de \\\\{SERVIDOR_UNC_PERMITIDO}\\...): {ruta!r}")
        return default
    return "\\\\" + "\\".join(segmentos)


# =====================================================================
# UTILIDADES DE ARCHIVOS
# =====================================================================
def limpiar_carpeta_temporal():
    if os.path.exists(CARPETA_TEMPORAL):
        shutil.rmtree(CARPETA_TEMPORAL)
    os.makedirs(CARPETA_TEMPORAL)


def existe_en_raiz(nombre: str) -> bool:
    return os.path.isfile(os.path.join(CARPETA_RAIZ_1076, nombre))


def colocar_archivo(ruta_origen: str) -> str:
    """Mueve el archivo a _TEMP (de ahí pasará a la raíz con el resto de la
    comanda). Devuelve siempre 'nueva'.

    _DUPLICADOS YA NO SE USA PARA NADA — histórico: antes, si ya existía un
    archivo con el mismo nombre en la raíz, se apartaban a _DUPLICADOS TANTO
    el nuevo COMO el que ya había (bug: una simple re-descarga sin cambios
    dejaba la pieza sin plànol en su sitio); luego se cambió a comparar y
    solo anular si había diferencias reales, dejando el idéntico intacto.
    Ahora es más simple y explícito: cualquier archivo cuyo nombre YA EXISTE
    en la raíz se considera sin más la nueva versión vigente — se anula
    (--ANUL·LAT--) el que había, sin mirar si el contenido cambió o no, y el
    nuevo pasa a ocupar su sitio. El proveedor no siempre sube bien el
    número de revisión, así que un nombre repetido no es garantía de que el
    contenido sea el mismo."""
    nombre = os.path.basename(ruta_origen)
    if existe_en_raiz(nombre):
        nombre_anulado = _anular_archivo_raiz(CARPETA_RAIZ_1076, nombre)
        if nombre_anulado:
            log_sse("FILE", f"{nombre} (ja existia amb aquest nom) → anul·lat com a {nombre_anulado}")
            _invalidar_cache_listado(CARPETA_RAIZ_1076)
    try:
        shutil.move(ruta_origen, os.path.join(CARPETA_TEMPORAL, nombre))
    except Exception:
        pass
    return "nueva"


def mover_temp_a_raiz(nombre: str):
    base = os.path.splitext(nombre)[0]
    for f in os.listdir(CARPETA_TEMPORAL):
        base_f, ext_f = os.path.splitext(f)
        if base_f == base and ext_f.lower() in EXTENSIONES_ASOCIADAS:
            src = os.path.join(CARPETA_TEMPORAL, f)
            dst = os.path.join(CARPETA_RAIZ_1076, f)
            try:
                shutil.move(src, dst)
            except Exception:
                pass
    _invalidar_cache_listado(CARPETA_RAIZ_1076)


def _anular_archivo_raiz(carpeta: str, nombre: str) -> Optional[str]:
    """Marca un archivo de `carpeta` como anulado anteponiendo ANUL_PREFIX
    — mismo criterio idempotente que usa el Anulador (si el destino ya
    existe, añade un sufijo __dupN en vez de sobrescribir). Devuelve el
    nombre final usado, o None si el archivo no existe o falla el rename."""
    origen = os.path.join(carpeta, nombre)
    if not os.path.isfile(origen):
        return None
    destino = os.path.join(carpeta, ANUL_PREFIX + nombre)
    destino_final = destino
    contador = 1
    while os.path.exists(destino_final):
        base, ext = os.path.splitext(destino)
        destino_final = f"{base}__dup{contador}{ext}"
        contador += 1
    try:
        os.rename(origen, destino_final)
        return os.path.basename(destino_final)
    except OSError as e:
        log.error(f"[Descarga] Error anulando {nombre}: {e}")
        return None


def _resolver_duplicados_con_comparacion(carpeta_ext: str, carpeta_raiz: str, carpeta_comercial_num: str) -> dict[str, dict]:
    """Antes de que el bucle principal llame a colocar_archivo() (que ahora
    SIEMPRE anula cualquier archivo cuyo nombre ya exista en la raíz, tenga
    o no el mismo contenido — ver colocar_archivo): para cada PDF recién
    descargado que coincida en nombre con uno ya existente, se compara
    contra el que había MIENTRAS AÚN EXISTEN LAS DOS COPIAS (el de la raíz
    todavía no se ha anulado, el nuevo todavía no se ha movido) — es la
    única ventana en la que se puede generar el PDF de diferencias.

    Esta función ya NO decide si se anula o no — eso lo hace siempre
    colocar_archivo() para cualquier extensión (pdf/dxf/step). Aquí solo se
    genera la comparación informativa (que puede salir sin diferencias si
    el contenido resulta ser idéntico — igualmente se anula el antiguo,
    porque el proveedor no siempre sube bien el número de revisión y un
    nombre repetido no es garantía de que el contenido sea el mismo).

    Devuelve las comparaciones (por código base) para que se adjunten a la
    pieza exactamente igual que las de una revisión distinta."""
    comparaciones: dict[str, dict] = {}
    try:
        archivos = os.listdir(carpeta_ext)
    except Exception:
        return comparaciones

    for archivo in archivos:
        if not archivo.lower().endswith(".pdf"):
            continue
        ruta_nuevo = os.path.join(carpeta_ext, archivo)
        if not os.path.isfile(ruta_nuevo) or not existe_en_raiz(archivo):
            continue  # nombre nuevo -> flujo de siempre (pieza nueva o revisión distinta)

        m = RE_CODIGO_BASE_REV.match(archivo)
        codigo_base = m.group("base") if m else os.path.splitext(archivo)[0]
        ruta_raiz = os.path.join(carpeta_raiz, archivo)

        log_sse("COMPARE", f"{archivo} ja existeix a la raíz amb el mateix nom — comparant abans de substituir-lo...")
        ruta_diff = os.path.join(carpeta_comercial_num, f"{codigo_base}_DIFERENCIES.pdf")
        resultado = comparar_planols(ruta_raiz, ruta_nuevo, codigo_base, ruta_diff)

        if resultado:
            comparaciones[codigo_base] = resultado
            if resultado["tiene_diferencias"]:
                log_sse("COMPARE", f"{resultado['num_diferencias']} diferència(es) trobades")
            else:
                log_sse("COMPARE", "Contingut idèntic, cap diferència trobada")

    return comparaciones


def aplanar_carpeta(carpeta_ext: str):
    """Mueve todos los archivos de subcarpetas al nivel raíz de carpeta_ext."""
    for elem in list(os.listdir(carpeta_ext)):
        ruta_e = os.path.join(carpeta_ext, elem)
        if os.path.isdir(ruta_e):
            for sub in os.listdir(ruta_e):
                src = os.path.join(ruta_e, sub)
                dst = os.path.join(carpeta_ext, sub)
                if os.path.isfile(src):
                    if os.path.exists(dst):
                        try:
                            os.remove(dst)
                        except Exception:
                            pass
                    try:
                        shutil.move(src, dst)
                    except Exception:
                        pass
            try:
                shutil.rmtree(ruta_e)
            except Exception:
                pass


def _invalidar_cache_listado(carpeta: str):
    _CACHE_LISTADOS.pop(carpeta, None)


def _listar_con_cache(carpeta: str) -> list[str]:
    """os.listdir con una caché de _CACHE_TTL_SEGUNDOS. CARPETA_RAIZ_1076 es
    una unidad de red con ~28.000 archivos — sin caché, cada letra tecleada
    en el buscador del portal dispararía un listado completo por red."""
    ahora = time.time()
    entrada = _CACHE_LISTADOS.get(carpeta)
    if entrada and (ahora - entrada[0]) < _CACHE_TTL_SEGUNDOS:
        return entrada[1]
    try:
        archivos = os.listdir(carpeta)
    except Exception:
        archivos = []
    _CACHE_LISTADOS[carpeta] = (ahora, archivos)
    return archivos


def buscar_archivo_por_prefijo(
    carpeta: str,
    prefijo: str,
    extensiones: tuple[str, ...] | None = None,
    usar_cache: bool = False,
) -> Optional[str]:
    """Devuelve el nombre del primer archivo de `carpeta` cuyo nombre empiece
    por `prefijo` (case-insensitive). Si hay varias coincidencias, prefiere
    el PDF. Usado para localizar plànols por código cliente o código PDM.

    IMPORTANTE: se filtra por prefijo ANTES de llamar a os.path.isfile — con
    ~28.000 archivos en una unidad de red, comprobar isfile() de todos ellos
    (en vez de solo de los que ya coinciden) tarda varios segundos y hace
    inservible la búsqueda "en tiempo real". `usar_cache=True` reutiliza el
    listado de _listar_con_cache; para servir un archivo (no solo comprobar
    que existe) se deja en False para no arriesgarse a servir algo obsoleto
    justo después de una descarga."""
    if not os.path.isdir(carpeta):
        return None
    prefijo = prefijo.strip().lower()
    if not prefijo:
        return None
    archivos = _listar_con_cache(carpeta) if usar_cache else os.listdir(carpeta)
    candidatos = []
    for f in archivos:
        nombre = f.lower()
        if not nombre.startswith(prefijo):
            continue
        if extensiones and not nombre.endswith(extensiones):
            continue
        if not os.path.isfile(os.path.join(carpeta, f)):
            continue
        candidatos.append(f)
    if not candidatos:
        return None
    candidatos.sort(key=lambda f: (0 if f.lower().endswith(".pdf") else 1, f))
    return candidatos[0]


def _codigos_con_planol(carpeta: str, extensiones: tuple[str, ...] = (".pdf", ".dxf")) -> set[str]:
    """Conjunto de 'códigos' (la parte del nombre antes del primer guión)
    de los archivos de `carpeta` con esas extensiones — para comprobar
    disponibilidad de plànol de MUCHOS resultados de golpe con lookups
    O(1) en vez de un escaneo de la carpeta entera por cada uno."""
    codigos = set()
    for f in _listar_con_cache(carpeta):
        nombre = f.lower()
        if not nombre.endswith(extensiones):
            continue
        codigo = os.path.splitext(f)[0].split("-")[0].strip().lower()
        if codigo:
            codigos.add(codigo)
    return codigos


# =====================================================================
# UTILIDADES EXCEL
# =====================================================================
def buscar_excel_por_codigo(codigo: str, carpeta: str = None):
    """Busca el Excel tanto por código cliente (partes[0]) como por código PDM (partes[1])."""
    carpeta = carpeta or CARPETA_EXCELS
    if not os.path.exists(carpeta):
        return None, None
    codigo = codigo.strip()
    for f in os.listdir(carpeta):
        if not f.lower().endswith(('.xlsx', '.xls', '.xlsm')):
            continue
        nombre_sin_ext = os.path.splitext(f)[0]
        partes = nombre_sin_ext.split(" -- ")
        if len(partes) == 2:
            if partes[0].strip() == codigo or partes[1].strip() == codigo:
                return os.path.join(carpeta, f), partes[1].strip()
    return None, None


def extraer_datos_excel(ruta_excel: str) -> dict:
    try:
        wb = openpyxl.load_workbook(ruta_excel, data_only=True)
        ws = wb.active
        datos = {
            "ref":   str(ws["B11"].value or "").strip(),
            "desc":  str(ws["E11"].value or "").strip(),
            "tract": str(ws["F11"].value or "").strip(),
            "grosor": str(ws["P11"].value or "").strip(),
        }
        wb.close()
        return datos
    except Exception:
        return {"ref": "", "desc": "", "tract": "", "grosor": ""}


def _normalizar(texto: str) -> str:
    """minúsculas + sin acentos, para que el buscador ignore mayúsculas y
    tildes ("Suport" / "suport", "descripció" / "descripcio")."""
    texto = (texto or "").lower()
    texto = unicodedata.normalize("NFKD", texto)
    return "".join(c for c in texto if not unicodedata.combining(c))


def _extraer_fila_11_rapido(ruta_excel: str) -> dict:
    """Igual que extraer_datos_excel pero con read_only=True y leyendo solo
    la fila 11 vía iter_rows en vez de cargar el libro entero — con ~5.000
    excels en una unidad de red la diferencia es ~250ms/archivo (carga
    completa) vs ~50ms/archivo (dirigido), es decir ~21 min vs ~4 min para
    indexar todos. Solo se usa para el indexado masivo; extraer_datos_excel
    se deja tal cual para los sitios que ya la usaban (abrir Excel, refresh
    de una pieza suelta), donde no importa la diferencia de unos ms."""
    try:
        wb = openpyxl.load_workbook(ruta_excel, data_only=True, read_only=True)
        try:
            ws = wb.active
            fila = next(
                ws.iter_rows(min_row=11, max_row=11, min_col=2, max_col=16, values_only=True),
                None,
            )
        finally:
            wb.close()
        if not fila:
            return {"ref": "", "desc": "", "tract": "", "grosor": ""}

        def val(i: int) -> str:
            return str(fila[i] or "").strip() if i < len(fila) else ""

        # columnas B(2) E(5) F(6) P(16) -> índices 0-based 0, 3, 4, 14
        return {"ref": val(0), "desc": val(3), "tract": val(4), "grosor": val(14)}
    except Exception:
        return {"ref": "", "desc": "", "tract": "", "grosor": ""}


def _construir_indice(carpeta: str = None) -> list[dict]:
    """Lee TODOS los excels de `carpeta` (por defecto CARPETA_EXCELS) y
    construye el índice de piezas. Es una función síncrona pensada para
    ejecutarse en un thread aparte (run_in_executor) porque tarda varios
    minutos."""
    carpeta = carpeta or CARPETA_EXCELS
    if not os.path.isdir(carpeta):
        return []
    indice = []
    for f in os.listdir(carpeta):
        if not f.lower().endswith((".xlsx", ".xls", ".xlsm")):
            continue
        partes = os.path.splitext(f)[0].split(" -- ")
        if len(partes) != 2:
            continue
        codigo_cliente, codigo_pdm = partes[0].strip(), partes[1].strip()
        if not codigo_cliente or not codigo_pdm:
            continue
        datos = _extraer_fila_11_rapido(os.path.join(carpeta, f))
        indice.append({
            "codigoCliente": codigo_cliente,
            "codigoPdm": codigo_pdm,
            "refCliente": datos["ref"],
            "desc": datos["desc"],
            "tract": datos["tract"],
            "grosor": datos["grosor"],
        })
    return indice


def _guardar_indice(indice: list[dict]):
    """Guarda la caché de l'índex -- escriptura atòmica (temporal + rename)
    perquè ara pot haver-hi més d'un PC llegint-la des de \\SRVDADES mentre
    un altre la regenera amb /reindexar."""
    try:
        os.makedirs(os.path.dirname(RUTA_INDICE_PIEZAS), exist_ok=True)
        tmp = f"{RUTA_INDICE_PIEZAS}.tmp{os.getpid()}"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(indice, f, ensure_ascii=False)
        os.replace(tmp, RUTA_INDICE_PIEZAS)
    except Exception as e:
        log.error(f"[Indice] Error guardando caché: {e}")


def _cargar_indice_cache() -> list[dict]:
    try:
        if os.path.exists(RUTA_INDICE_PIEZAS):
            with open(RUTA_INDICE_PIEZAS, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception as e:
        log.error(f"[Indice] Error cargando caché: {e}")
    return []


async def _reindexar_async():
    """Reconstruye el índice completo en un thread aparte y lo cachea a
    disco. Si ya hay un reindexado en curso, no arranca uno segundo."""
    global _INDICE_PIEZAS, _indexando, _ultimo_indexado
    if _indexando:
        return
    _indexando = True
    log.info("[Indice] Reindexado iniciado...")
    t0 = time.time()
    try:
        loop = asyncio.get_event_loop()
        indice = await loop.run_in_executor(None, _construir_indice)
        _INDICE_PIEZAS = indice
        _guardar_indice(indice)
        _ultimo_indexado = datetime.utcnow().isoformat()
        log.info(f"[Indice] Reindexado completo: {len(indice)} piezas en {time.time()-t0:.1f}s")
    except Exception as e:
        log.error(f"[Indice] Error reindexando: {e}")
    finally:
        _indexando = False


INTERVALO_REINDEXADO = 600  # 10 minuts


async def _reindexar_periodico():
    """Refresca l'índex per defecte cada INTERVALO_REINDEXADO en segon pla
    -- perquè una peça nova (Excel acabat de crear) aparegui sola al
    cercador sense que ningú s'hagi d'acordar de prémer "Actualitzar"."""
    while True:
        await asyncio.sleep(INTERVALO_REINDEXADO)
        await _reindexar_async()


# Índices para rutas de excels DISTINTAS a la por defecto (CARPETA_EXCELS)
# — la mayoría de peticiones usan la ruta por defecto y van a _INDICE_PIEZAS
# (cacheado a disco, precargado al arrancar, exactamente como antes de que
# existiera la config por usuario). Solo si alguien configura una ruta de
# excels distinta en Ajustos se usa este caché en memoria, construido bajo
# demanda la primera vez que se pide — no se persiste a disco porque es un
# caso raro, no el camino caliente.
_indices_alt: dict[str, list[dict]] = {}
_indexando_alt: set[str] = set()


async def _obtener_indice_para_ruta(ruta_excels: str) -> list[dict]:
    """Devuelve el índice de piezas para `ruta_excels` (ya validada). Si es
    la ruta por defecto, usa _INDICE_PIEZAS de siempre. Si es otra y aún no
    se ha construido, arranca la construcción en background y devuelve una
    lista vacía por ahora — la siguiente búsqueda con esa misma ruta ya la
    encontrará lista (o, si tarda varios minutos, seguirá vacía hasta
    entonces en vez de bloquear la petición)."""
    if ruta_excels == CARPETA_EXCELS:
        return _INDICE_PIEZAS
    if ruta_excels in _indices_alt:
        return _indices_alt[ruta_excels]
    if ruta_excels not in _indexando_alt:
        asyncio.create_task(_construir_indice_alt_async(ruta_excels))
    return []


async def _construir_indice_alt_async(ruta_excels: str):
    global _indices_alt, _indexando_alt
    _indexando_alt.add(ruta_excels)
    log.info(f"[Indice] Reindexado (ruta alternativa) iniciado: {ruta_excels}")
    t0 = time.time()
    try:
        loop = asyncio.get_event_loop()
        indice = await loop.run_in_executor(None, _construir_indice, ruta_excels)
        _indices_alt[ruta_excels] = indice
        log.info(f"[Indice] Reindexado completo para {ruta_excels}: {len(indice)} piezas en {time.time()-t0:.1f}s")
    except Exception as e:
        log.error(f"[Indice] Error reindexando {ruta_excels}: {e}")
    finally:
        _indexando_alt.discard(ruta_excels)


def _codigos_cliente_por_comanda(q: str) -> set[str]:
    """Códigos cliente de piezas del historial cuya comanda coincide con q
    — el índice de excels no sabe de comandas (una pieza puede reutilizarse
    en muchas o no haberse descargado nunca), así que buscar por número de
    comanda mira en el historial de descargas en vez de en el índice."""
    q = q.strip()
    if not q:
        return set()
    q_norm = _normalizar(q)
    codigos = set()
    for h in cargar_historial():
        if q_norm and q_norm in _normalizar(h.get("comanda", "")):
            cc = h.get("file", "").split("-")[0].split(".")[0].strip()
            if cc:
                codigos.add(cc)
    return codigos


# =====================================================================
# ENDPOINTS
# =====================================================================



# =====================================================================
# HISTORIAL PERSISTENT DE PECES -- COMPARTIT entre PCs (veure RUTA_HISTORIAL)
# =====================================================================
# Com que ara més d'un servidor (un per PC) pot llegir/escriure el mateix
# arxiu a \\SRVDADES alhora, calen dues proteccions que abans no feien
# falta quan tot vivia en local a C:\DXF TEMPORAL\MACROS:
#   1. Lock entre processos (_lock_historial) al voltant de tot cicle
#      llegir-modificar-escriure, perquè dos PCs escrivint gairebé alhora
#      no es "trepitgin" i cap dels dos canvis es perdi.
#   2. Escriptura atòmica (escriu a un temporal + rename) perquè un altre
#      PC llegint en aquell instant mai vegi l'arxiu a mig escriure.

RUTA_HISTORIAL_LOCK = RUTA_HISTORIAL + ".lock"


@contextlib.contextmanager
def _lock_historial(timeout: float = 10.0):
    """Lock exclusiu basat en la creació atòmica d'un arxiu sentinella
    (O_CREAT|O_EXCL -- atòmic també entre PCs sobre SMB). Si un lock queda
    penjat (un procés que va morir sense alliberar-lo) es considera
    abandonat passats 30s i es trenca sol, perquè ningú es quedi bloquejat
    per sempre."""
    aconseguit = False
    inici = time.monotonic()
    while True:
        try:
            fd = os.open(RUTA_HISTORIAL_LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.close(fd)
            aconseguit = True
            break
        except FileExistsError:
            try:
                if time.time() - os.path.getmtime(RUTA_HISTORIAL_LOCK) > 30:
                    os.remove(RUTA_HISTORIAL_LOCK)
                    continue
            except OSError:
                pass
            if time.monotonic() - inici > timeout:
                log.error("[Historial] Lock ocupat massa temps, es continua sense lock")
                break
            time.sleep(0.05)
        except OSError as e:
            log.error(f"[Historial] Error creant el lock: {e}")
            break
    try:
        yield
    finally:
        if aconseguit:
            try:
                os.remove(RUTA_HISTORIAL_LOCK)
            except OSError:
                pass


def cargar_historial() -> list[dict]:
    """Carga el historial desde disco."""
    try:
        if os.path.exists(RUTA_HISTORIAL):
            with open(RUTA_HISTORIAL, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception as e:
        log.error(f"[Historial] Error cargando: {e}")
    return []


def guardar_historial(historial: list[dict]):
    """Guarda el historial en disco -- escriptura atòmica (temporal +
    os.replace) perquè un altre PC llegint mai vegi un arxiu a mitges."""
    try:
        carpeta = os.path.dirname(RUTA_HISTORIAL)
        os.makedirs(carpeta, exist_ok=True)
        tmp = f"{RUTA_HISTORIAL}.tmp{os.getpid()}"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(historial, f, ensure_ascii=False, indent=2)
        os.replace(tmp, RUTA_HISTORIAL)
    except Exception as e:
        log.error(f"[Historial] Error guardando: {e}")


def añadir_piezas_al_historial(piezas: list):
    """Añade piezas nuevas al historial con estado pendiente.

    Cada pieza ya trae su propio campo `comanda` (asignado durante la
    descarga), así que no hace falta — y sería incorrecto — asociar todas
    las piezas de un lote a una única comanda pasada por parámetro.
    """
    ahora = datetime.utcnow().isoformat()
    añadidas = 0
    with _lock_historial():
        historial = cargar_historial()
        for pieza in piezas:
            p = pieza if isinstance(pieza, dict) else pieza.dict()
            comanda = p.get("comanda", "")
            existe = any(
                h["file"] == p["file"] and h["comanda"] == comanda
                for h in historial
            )
            if not existe:
                historial.append({
                    **p,
                    "estado": "pendiente",  # pendiente | ok
                    "fecha": ahora,
                    "id": f"{comanda}_{p['file']}",
                })
                añadidas += 1
        guardar_historial(historial)
    log.info(f"[Historial] {añadidas} pieza(s) nuevas añadidas al historial")


@app.get("/historial")
def get_historial():
    """Devuelve el historial completo de piezas procesadas."""
    return {"piezas": cargar_historial()}


@app.patch("/historial/{id_pieza}")
def actualizar_estado_pieza(id_pieza: str, body: dict):
    """Marca una pieza como ok o pendiente."""
    with _lock_historial():
        historial = cargar_historial()
        for pieza in historial:
            if pieza.get("id") == id_pieza:
                pieza["estado"] = body.get("estado", pieza["estado"])
                guardar_historial(historial)
                return {"ok": True, "pieza": pieza}
    raise HTTPException(404, f"Pieza {id_pieza} no encontrada")


@app.delete("/historial")
def limpiar_historial_ok():
    """Elimina del historial todas las piezas marcadas como ok."""
    with _lock_historial():
        historial = cargar_historial()
        antes = len(historial)
        historial = [p for p in historial if p.get("estado") != "ok"]
        guardar_historial(historial)
    return {"ok": True, "eliminadas": antes - len(historial)}


@app.delete("/historial/todo")
def limpiar_historial_todo():
    """Elimina todo el historial."""
    with _lock_historial():
        guardar_historial([])
    return {"ok": True}

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/descargar", response_model=DescargaResponse)
def descargar(req: DescargaRequest):
    """Descarga manual de una o varias comandas (llamada desde EntradaComandas).

    Reutiliza _hacer_descarga (la misma lógica que usa la cola automática)
    en vez de duplicar la automatización de Playwright: antes había dos
    copias casi idénticas de ~120 líneas que había que mantener en sync.
    """
    global _comandas_pendientes
    if not req.comandas:
        raise HTTPException(400, "Lista de comandas vacía")
    # Limpiar pendientes que ya se van a descargar
    _comandas_pendientes = [c for c in _comandas_pendientes if c not in req.comandas]

    try:
        return _hacer_descarga(req)
    except Exception as e:
        log.error(f"[Descargar] Error en descarga manual {req.comandas}: {e}")
        raise HTTPException(500, f"Error en la descarga: {e}")


@app.post("/abrir-solidworks")
def abrir_solidworks(req: AbrirRequest):
    nombre = req.file
    ruta_step = os.path.join(CARPETA_RAIZ_1076, nombre)

    # Si aún está en _TEMP, moverla primero
    ruta_temp = os.path.join(CARPETA_TEMPORAL, nombre)
    if not os.path.isfile(ruta_step) and os.path.isfile(ruta_temp):
        mover_temp_a_raiz(nombre)

    if not os.path.isfile(ruta_step):
        raise HTTPException(404, f"Archivo no encontrado: {nombre}")

    # Escribir TXT intermedio para la macro de SolidWorks
    try:
        os.makedirs(os.path.dirname(RUTA_TXT_INTERMEDIO), exist_ok=True)
        with open(RUTA_TXT_INTERMEDIO, "w", encoding="utf-8") as f:
            f.write(f"{ruta_step}\n")
            f.write(f"{float(req.factor_k)}\n")
            f.write(f"{req.codigo_pdm or ''}\n")
    except Exception as e:
        raise HTTPException(500, f"Error escribiendo TXT intermedio: {e}")

    # Solo abrir el STEP en SolidWorks, nada más
    try:
        os.startfile(ruta_step)
    except Exception as e:
        raise HTTPException(500, f"No se pudo abrir el STEP: {e}")

    return {"ok": True, "file": nombre, "ruta": ruta_step}


@app.post("/procesar-todas")
def procesar_todas(piezas: list[AbrirRequest]):
    resultados = []
    for p in piezas:
        try:
            abrir_solidworks(p)
            resultados.append({"file": p.file, "ok": True})
        except HTTPException as e:
            resultados.append({"file": p.file, "ok": False, "error": e.detail})
    return {"resultados": resultados}


# =====================================================================
# WEBHOOK — DETECCIÓN DE COMANDAS VÍA POWER AUTOMATE
# =====================================================================

def extraer_codigo_de_asunto(asunto: str) -> Optional[str]:
    """Extrae el primer código de 10 dígitos del asunto del email."""
    match = PATRON_CODIGO.search(asunto)
    return match.group(1) if match else None


def leer_comandas_de_txt() -> list[str]:
    """
    Lee el archivo inbox_tavil.txt donde Power Automate escribe los asuntos.
    Cada línea es un asunto de email. Extrae códigos de 10 dígitos.
    Después de leer, vacía el archivo para no reprocesar.
    """
    if not os.path.exists(RUTA_INBOX_TXT):
        return []
    try:
        with open(RUTA_INBOX_TXT, "r", encoding="utf-8") as f:
            lineas = f.readlines()

        # Vaciar el archivo tras leerlo
        with open(RUTA_INBOX_TXT, "w", encoding="utf-8") as f:
            f.write("")

        codigos = []
        for linea in lineas:
            codigo = extraer_codigo_de_asunto(linea.strip())
            if codigo:
                codigos.append(codigo)

        return list(dict.fromkeys(codigos))

    except Exception as e:
        log.error(f"[TXT] Error leyendo inbox_tavil.txt: {e}")
        return []


class WebhookEmailRequest(BaseModel):
    asunto: str
    remitente: Optional[str] = ""

@app.post("/webhook-email")
def webhook_email(req: WebhookEmailRequest):
    """
    Power Automate llama a este endpoint cuando llega un email de Tavil.
    Body JSON: { "asunto": "...", "remitente": "..." }
    """
    global _comandas_pendientes, _comandas_ya_vistas

    # Filtrar: solo emails de los remitentes autorizados
    remitente = req.remitente.lower()
    if remitente and not any(r in remitente for r in OUTLOOK_REMITENTES):
        return {"ok": True, "codigo": None, "msg": "Remitente ignorado"}

    codigo = extraer_codigo_de_asunto(req.asunto)
    if not codigo:
        return {"ok": True, "codigo": None, "msg": "Sin código de 10 dígitos en el asunto"}

    if codigo not in _comandas_ya_vistas:
        _comandas_ya_vistas.add(codigo)
        _comandas_pendientes = list(dict.fromkeys(_comandas_pendientes + [codigo]))
        log.info(f"[Webhook] Nueva comanda detectada: {codigo}")

    return {"ok": True, "codigo": codigo, "msg": f"Comanda {codigo} registrada"}

@app.get("/check-email")
def check_email():
    """Lee Outlook directamente y devuelve comandas nuevas de las últimas 24h."""
    global _comandas_pendientes, _comandas_ya_vistas
    codigos = leer_comandas_de_txt()
    nuevos  = [c for c in codigos if c not in _comandas_ya_vistas]
    _comandas_ya_vistas.update(nuevos)
    _comandas_pendientes = list(dict.fromkeys(_comandas_pendientes + nuevos))
    return {"codigos": nuevos, "total": len(nuevos)}


@app.get("/comandas-pendientes")
def comandas_pendientes():
    """Devuelve las comandas detectadas automáticamente pendientes de procesar."""
    return {"codigos": _comandas_pendientes}


@app.delete("/comandas-pendientes")
def limpiar_pendientes():
    """Limpia la lista de comandas pendientes."""
    global _comandas_pendientes
    _comandas_pendientes = []
    return {"ok": True}


async def _polling_inbox_txt():
    """Tarea background: revisa Outlook via EWS cada 5 minutos y acumula comandas pendientes."""
    await asyncio.sleep(60)  # espera 1 min al arrancar antes del primer check
    while True:
        try:
            global _comandas_pendientes, _comandas_ya_vistas
            codigos = leer_comandas_de_txt()
            nuevos  = [c for c in codigos if c not in _comandas_ya_vistas]
            if nuevos:
                _comandas_ya_vistas.update(nuevos)
                _comandas_pendientes = list(dict.fromkeys(_comandas_pendientes + nuevos))
                log.info(f"[EWS Polling] Nuevas comandas: {nuevos}")
        except Exception as e:
            log.error(f"[EWS Polling] Error: {e}")
        await asyncio.sleep(300)  # 5 minutos


def imprimir_pdf(ruta_pdf: str, impresora: Optional[str] = None) -> bool:
    """Imprime un PDF con SumatraPDF — dispara y olvida, sin esperar.
    `impresora` es la que ha elegido el usuario en Ajustos (guardada en su
    localStorage y enviada en el body de la petición); si no viene, se usa
    IMPRESORA como fallback. Devuelve True si se pudo lanzar el comando de
    impresión."""
    impresora = impresora or IMPRESORA
    if not os.path.isfile(ruta_pdf):
        log.warning(f"[Impresora] PDF no encontrado: {ruta_pdf}")
        return False
    if not os.path.isfile(SUMATRA_EXE):
        log.error(f"[Impresora] SumatraPDF no encontrado en {SUMATRA_EXE}")
        return False
    try:
        subprocess.Popen(
            [SUMATRA_EXE, "-print-to", impresora, "-silent", ruta_pdf],
            creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
        )
        log.info(f"[Impresora] Enviado a imprimir en '{impresora}': {os.path.basename(ruta_pdf)}")
        return True
    except Exception as e:
        log.error(f"[Impresora] Error: {e}")
        return False


@app.get("/auto-estado")
def auto_estado():
    """Devuelve el estado actual de la descarga automática."""
    return _auto_estado


async def _procesar_cola():
    """Procesa la cola de comandas una a una en background."""
    global _procesando, _cola_comandas
    if _procesando:
        return  # Ya hay un procesador corriendo, no arrancar otro
    _procesando = True
    log.info(f"[Cola] Procesador arrancado.")
    try:
        while _cola_comandas:
            item = _cola_comandas.pop(0)
            log.info(f"[Cola] Procesando {item['comanda']}. Quedan {len(_cola_comandas)} en cola.")
            await _ejecutar_auto_descarga(item["comanda"], item["pdf_correo"], item.get("accion", "imprimir"))
    finally:
        _procesando = False
        log.info(f"[Cola] Cola vacía. {len(_piezas_listas)} pieza(s) listas para consultar.")


async def _ejecutar_auto_descarga(comanda: str, pdf_correo: str, accion: str = "imprimir"):
    """Procesa una comanda: descarga, organiza PDFs, y al final imprime
    todos los PDFs o los deja listos como ZIP para descargar — según
    `accion` ("imprimir" | "descargar", ver toggle de Ajustos)."""
    global _auto_estado, _comandas_pendientes, _piezas_listas, _comandas_listas, _errores_recientes

    t_inicio = time.time()
    log_sse("INFO", f"═══ Nova comanda: {comanda} ═══")

    # Si no viene PDF del correo, buscar el más reciente en temp_pdf
    if not pdf_correo or not os.path.isfile(pdf_correo):
        ruta_temp_pdf = RUTA_TEMP_PDF
        if os.path.exists(ruta_temp_pdf):
            pdfs_temp = [
                os.path.join(ruta_temp_pdf, f)
                for f in os.listdir(ruta_temp_pdf)
                if f.lower().endswith('.pdf')
            ]
            if pdfs_temp:
                # Coger el más reciente
                pdf_correo = max(pdfs_temp, key=os.path.getmtime)
                log.info(f"[Auto] PDF del correo encontrado: {os.path.basename(pdf_correo)}")
                log_sse("FILE", f"PDF del correu trobat a temp_pdf: {os.path.basename(pdf_correo)}")

    _auto_estado = {"activo": True, "comanda": comanda, "fase": "⏳ Esperando 10 segundos antes de descargar...", "piezas": [], "errores": [], "done": False}
    log_sse("WAIT", "Esperant 10 segons abans de connectar al portal...")
    await asyncio.sleep(10)

    # Fase 1: Descargar del portal
    _auto_estado["fase"] = f"🌐 Conectando al portal y descargando comanda {comanda}..."
    log.info(f"[Auto] Iniciando descarga de comanda {comanda}")

    try:
        req = DescargaRequest(comandas=[comanda])
        # Ejecutar descarga en thread separado para no bloquear el event loop
        loop = asyncio.get_event_loop()
        resultado = await loop.run_in_executor(None, lambda: _hacer_descarga(req))

        _auto_estado["piezas"]  = [p.dict() for p in resultado.piezas]
        _auto_estado["errores"] = resultado.errores
        if resultado.errores:
            _errores_recientes.extend(f"{comanda}: {e}" for e in resultado.errores)
            _errores_recientes[:] = _errores_recientes[-20:]

        # Fase 2: copiar el PDF del correo a la carpeta comercial.
        # Los PDFs del portal ya se copiaron ahí dentro de _hacer_descarga
        # (por comanda, según se van procesando) — así el mismo código sirve
        # tanto para la descarga manual como para la automática por correo.
        _auto_estado["fase"] = f"📁 Organizando carpeta {comanda} en Comercial..."
        log_sse("STEP", f"Creant carpeta comercial: P:\\Comercial\\Tavil\\{comanda}\\")
        carpeta_comanda_comercial = os.path.join(CARPETA_COMERCIAL, comanda)
        os.makedirs(carpeta_comanda_comercial, exist_ok=True)

        # Copiar PDF del correo a carpeta comercial
        if pdf_correo and os.path.isfile(pdf_correo):
            nombre_correo = os.path.basename(pdf_correo)
            destino_correo = os.path.join(carpeta_comanda_comercial, nombre_correo)
            try:
                shutil.copy2(pdf_correo, destino_correo)
                log_sse("FILE", f"Copiant PDF adjunt del correu → P:\\Comercial\\Tavil\\{comanda}\\{nombre_correo}")
            except Exception as e:
                log.error(f"[Auto] Error copiando PDF correo: {e}")
                log_sse("ERROR", f"Error copiant el PDF del correu: {e}")

        # Fase 3: según el toggle de Ajustos, o bien imprimir TODOS los PDFs
        # ya organizados en la carpeta comercial de esta comanda (los del
        # portal + el del correo), o bien empaquetarlos en un ZIP para que
        # el navegador que esté mirando lo descargue. No hay usuario/
        # navegador de por medio en este flujo automático en general, así
        # que imprimir usa siempre IMPRESORA (impresora = None -> fallback
        # dentro de imprimir_pdf), no la config de ningún usuario concreto
        # — "descargar" solo tiene sentido cuando alguien lo está mirando
        # de verdad (p.ej. "Entorn de proves"), ver _descargas_pendientes.
        pdfs_comanda = sorted(
            f for f in os.listdir(carpeta_comanda_comercial)
            if f.lower().endswith('.pdf') and os.path.isfile(os.path.join(carpeta_comanda_comercial, f))
        )

        if accion == "descargar":
            _auto_estado["fase"] = f"📦 Empaquetando documentos de la comanda {comanda}..."
            log_sse("PRINT", "Mode: descarregar a l'ordinador")
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
                for f in pdfs_comanda:
                    z.write(os.path.join(carpeta_comanda_comercial, f), arcname=f)
            zip_bytes = buf.getvalue()
            _purgar_descargas_pendientes()
            _descargas_pendientes[comanda] = (time.time(), zip_bytes)
            log_sse("FILE", f"ZIP creat: {comanda}_documents.zip ({len(zip_bytes):,} bytes)")
            log_sse("OK", "ZIP disponible per descarregar")
            log.info(f"[Auto] ZIP de {len(pdfs_comanda)} PDF(s) listo para descargar (comanda {comanda})")
        else:
            # Se deja INTERVALO_ENTRE_IMPRESIONES entre cada Popen (con
            # asyncio.sleep, no bloqueante) para que SumatraPDF/el driver de
            # la impresora termine de procesar uno antes de recibir el
            # siguiente.
            _auto_estado["fase"] = f"🖨️ Imprimiendo documentos de la comanda {comanda}..."
            log_sse("PRINT", f"Imprimint PDFs de P:\\Comercial\\Tavil\\{comanda}\\...")
            for i, f in enumerate(pdfs_comanda):
                if i > 0:
                    await asyncio.sleep(INTERVALO_ENTRE_IMPRESIONES)
                imprimir_pdf(os.path.join(carpeta_comanda_comercial, f))
                log_sse("PRINT", f"Imprimint: {f} → {IMPRESORA}")
            log_sse("PRINT", f"Total: {len(pdfs_comanda)} PDFs enviats a la impressora")
            log.info(f"[Auto] {len(pdfs_comanda)} PDF(s) enviados a imprimir para la comanda {comanda}")

        # Limpiar comanda de pendientes
        _comandas_pendientes = [c for c in _comandas_pendientes if c != comanda]

        # Acumular piezas listas para mostrar en la app
        # (el historial ya se guarda dentro de _hacer_descarga, con la
        # comanda correcta por pieza — no hace falta repetirlo aquí)
        if _auto_estado["piezas"] and comanda not in _comandas_listas:
            _piezas_listas.extend(_auto_estado["piezas"])
            _comandas_listas.append(comanda)
            log.info(f"[Cola] {len(_auto_estado['piezas'])} pieza(s) acumuladas. Total listas: {len(_piezas_listas)}")

        _auto_estado["fase"] = f"✅ Comanda {comanda} completada — {len(_auto_estado['piezas'])} pieza(s) descargada(s)"
        _auto_estado["done"] = True
        elapsed = time.time() - t_inicio
        log_sse("OK", f"✅ Comanda {comanda} processada completament en {elapsed:.1f}s")
        log.info(f"[Auto] Comanda {comanda} procesada completamente.")

    except Exception as e:
        _auto_estado["fase"] = "❌ Error en la descarga automática"
        _auto_estado["errores"].append(str(e))
        _errores_recientes.append(f"{comanda}: {e}")
        _errores_recientes[:] = _errores_recientes[-20:]
        log.error(f"[Auto] Error en descarga automática de {comanda}: {e}")
        log_sse("ERROR", f"Error en la descàrrega automàtica: {e}")
        log_sse("INFO", f"Stack trace: {traceback.format_exc()}")


def _lanzar_navegador(p):
    """Lanza Chromium con flags de compatibilidad para ejecutarse como
    servicio Windows (sesión 0, sin escritorio ni sandbox de ventana)."""
    return p.chromium.launch(
        headless=True,
        args=[
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-gpu",
            "--disable-dev-shm-usage",
        ],
    )


def _hacer_descarga(req: DescargaRequest) -> DescargaResponse:
    """Descarga las comandas indicadas del portal, organiza los archivos y
    etiqueta cada pieza encontrada con la comanda que la generó.

    Se reintenta una vez el navegador completo (login incluido) si algo
    falla al lanzarlo o durante el login — bajo el servicio Windows estos
    fallos son más frecuentes que en sesión interactiva.
    """
    limpiar_carpeta_temporal()
    duplicados_sesion: list[str] = []
    errores: list[str] = []
    piezas: list[PiezaResult] = []

    intentos = 0
    while True:
        intentos += 1
        try:
            log_sse("STEP", "Iniciant Playwright (headless=True)...")
            with sync_playwright() as p:
                log_sse("STEP", "Obrint navegador Chromium...")
                browser = _lanzar_navegador(p)
                context = browser.new_context(accept_downloads=True)
                page    = context.new_page()

                log_sse("STEP", "Navegant al portal SharePoint de Tavil...")
                log_sse("INFO", f"URL: {URL_PORTAL}")
                page.goto(URL_PORTAL)
                page.wait_for_load_state("networkidle")

                log_sse("STEP", f"Introduint credencials ({PORTAL_USUARIO})...")
                page.fill('input[type="email"], input[name="loginfmt"]', PORTAL_USUARIO)
                if page.is_visible('#idSIButton9'):
                    page.click('#idSIButton9')
                else:
                    page.click('input[type="submit"]')
                page.wait_for_timeout(2000)
                page.fill('input[type="password"], input[name="passwd"]', PORTAL_CONTRASENYA)
                if page.is_visible('#idSIButton9'):
                    page.click('#idSIButton9')
                else:
                    page.click('input[type="submit"]')
                page.wait_for_load_state("networkidle")
                page.wait_for_timeout(2000)
                if page.is_visible('#idBtn_Back'):
                    page.click('#idBtn_Back')
                else:
                    try:
                        page.click('input[value="No"], button:has-text("No")')
                    except Exception:
                        pass
                page.wait_for_load_state("networkidle")
                log_sse("OK", "Login correcte")

                for num in req.comandas:
                    log_sse("STEP", f"Cercant comanda {num} al llistat...")
                    page.goto(URL_PORTAL)
                    page.wait_for_load_state("networkidle")
                    page.wait_for_timeout(3000)

                    encontrado = False
                    try:
                        page.click(f"text={num}", timeout=3000)
                        encontrado = True
                        log_sse("INFO", "Comanda trobada al llistat directament")
                    except Exception:
                        pass

                    if not encontrado:
                        log_sse("INFO", "No és al llistat visible — usant cercador de SharePoint...")
                        try:
                            selector = 'input[type="search"], input[role="combobox"][placeholder*="Buscar"]'
                            page.wait_for_selector(selector, timeout=5000)
                            page.click(selector)
                            page.fill(selector, num)
                            page.press(selector, "Enter")
                            page.wait_for_load_state("networkidle")
                            page.wait_for_timeout(4000)
                            log_sse("STEP", f"Fent click a comanda {num}...")
                            page.click(f"text={num}", timeout=4000)
                            encontrado = True
                        except Exception:
                            errores.append(f"Comanda {num} no encontrada")
                            log.warning(f"[Descarga] Comanda {num} no encontrada en el portal")
                            log_sse("ERROR", f"Comanda {num} no trobada al portal")
                            continue

                    page.wait_for_load_state("networkidle")
                    page.wait_for_timeout(2000)

                    ruta_zip = os.path.join(CARPETA_RAIZ_1076, f"_descarga_{num}.zip")
                    try:
                        log_sse("STEP", "Llançant descàrrega del ZIP...")
                        log_sse("WAIT", "Esperant que el ZIP es descarregui...")
                        with page.expect_download(timeout=60000) as dl_info:
                            page.click('button[data-automationid="downloadCommand"]')
                        dl = dl_info.value
                        dl.save_as(ruta_zip)
                        time.sleep(2)
                        tam_zip = os.path.getsize(ruta_zip) if os.path.isfile(ruta_zip) else 0
                        log_sse("OK", f"ZIP descarregat: _descarga_{num}.zip ({tam_zip:,} bytes)")

                        log_sse("STEP", "Descomprimint ZIP...")
                        carpeta_ext = os.path.join(CARPETA_RAIZ_1076, f"_ext_{num}")
                        os.makedirs(carpeta_ext, exist_ok=True)
                        with zipfile.ZipFile(ruta_zip, 'r') as z:
                            z.extractall(carpeta_ext)
                        try:
                            os.remove(ruta_zip)
                        except Exception:
                            pass
                        log_sse("FILE", f"Arxius extrets: {len(os.listdir(carpeta_ext))} arxius")

                        log_sse("FILE", "Aplanant subcarpetes...")
                        aplanar_carpeta(carpeta_ext)

                        # Se etiqueta cada pieza con `num` aquí mismo, en el
                        # momento en que sabemos de qué comanda viene — antes
                        # se escaneaba _TEMP entero al final sin distinguir
                        # comanda, así que con varias comandas en un mismo
                        # lote era imposible saber cuál era cuál.
                        carpeta_comercial_num = os.path.join(CARPETA_COMERCIAL, num)
                        # Resultados de comparar_planols() por código base
                        # ("XXXXXXXX-XXXXXXXX"), rellenado por la rama .pdf de
                        # abajo y leído por la rama STEP para adjuntarlo a la
                        # pieza. Por eso se listan los PDFs ANTES que el resto
                        # (sorted key) — así el resultado ya está listo cuando
                        # le toca al STEP hermano, sin importar el orden real
                        # de os.listdir().
                        # Antes de colocar los archivos: si algún PDF descargado
                        # tiene el MISMO NOMBRE que uno que ya existe en la raíz
                        # (misma pieza, misma revisión — lo que colocar_archivo()
                        # llama "duplicado" y apartaba sin más a _DUPLICADOS sin
                        # mirar el contenido), ahora se comparan de verdad: el
                        # proveedor no siempre sube bien el número de revisión, así
                        # que el contenido puede haber cambiado aunque el nombre
                        # sea idéntico. Si hay diferencias reales, se anula el
                        # conjunto antiguo (pdf/dxf/step) para que el nuevo pase a
                        # ocupar su sitio como versión vigente; si el contenido es
                        # igual, sigue siendo un duplicado real y se comporta como
                        # siempre (colocar_archivo lo aparta a _DUPLICADOS).
                        comparaciones_comanda: dict[str, dict] = _resolver_duplicados_con_comparacion(
                            carpeta_ext, CARPETA_RAIZ_1076, carpeta_comercial_num
                        )
                        conteo_ext = {"step": 0, "pdf": 0, "dxf": 0}
                        for archivo in sorted(
                            os.listdir(carpeta_ext),
                            key=lambda f: (0 if f.lower().endswith(".pdf") else 1, f),
                        ):
                            ruta_a = os.path.join(carpeta_ext, archivo)
                            if not os.path.isfile(ruta_a):
                                continue

                            ext_lower = os.path.splitext(archivo)[1].lower()
                            if ext_lower in (".step", ".stp"):
                                conteo_ext["step"] += 1
                                log_sse("FILE", f"Arxiu trobat: {archivo}")
                            elif ext_lower == ".pdf":
                                conteo_ext["pdf"] += 1
                                log_sse("FILE", f"Arxiu trobat: {archivo}")
                            elif ext_lower == ".dxf":
                                conteo_ext["dxf"] += 1
                                log_sse("FILE", f"Arxiu trobat: {archivo}")

                            tipo = colocar_archivo(ruta_a)

                            if archivo.lower().endswith('.pdf'):
                                # El PDF del plànol va también a la carpeta comercial
                                # de ESTA comanda — antes solo lo hacía el flujo
                                # automático por correo, así que una descarga manual
                                # nunca llegaba a crear P:\Comercial\Tavil\<comanda>\.
                                # colocar_archivo() siempre mueve a _TEMP (ya no hay
                                # rama "duplicado" -> _DUPLICADOS).
                                ruta_pdf = os.path.join(CARPETA_TEMPORAL, archivo)
                                try:
                                    os.makedirs(carpeta_comercial_num, exist_ok=True)
                                    shutil.copy2(ruta_pdf, os.path.join(carpeta_comercial_num, archivo))
                                    log_sse("FILE", f"Copiant PDF del portal → P:\\Comercial\\Tavil\\{num}\\{archivo}")
                                except Exception as e:
                                    log.error(f"[Descarga] Error copiando PDF a comercial ({num}): {e}")
                                    log_sse("ERROR", f"Error copiant PDF a comercial: {e}")

                                # Comparador de plànols: si existe una revisión
                                # anterior (vigente o ya anulada) del mismo código
                                # base en la raíz, se comparan y se genera un PDF
                                # de diferencias en la carpeta comercial. Nunca debe
                                # tumbar la descarga — comparar_planols() blinda
                                # sus propios errores y devuelve None si algo falla.
                                m_base = RE_CODIGO_BASE_REV.match(archivo)
                                if m_base:
                                    codigo_base = m_base.group("base")
                                    rev_nueva = int(m_base.group("rev"))
                                    log_sse("COMPARE", f"Cercant versió anterior de {codigo_base} a P:\\Fabricacio\\PLANOLS\\1076\\...")
                                    ruta_anterior = _buscar_planol_anterior(CARPETA_RAIZ_1076, codigo_base, rev_nueva)
                                    if ruta_anterior:
                                        log_sse("COMPARE", f"Trobat: {os.path.basename(ruta_anterior)} (revisió anterior)")
                                        if os.path.isfile(ruta_pdf):
                                            ruta_diff = os.path.join(carpeta_comercial_num, f"{codigo_base}_DIFERENCIES.pdf")
                                            resultado_comp = comparar_planols(ruta_anterior, ruta_pdf, codigo_base, ruta_diff)
                                            if resultado_comp:
                                                comparaciones_comanda[codigo_base] = resultado_comp
                                                log.info(
                                                    f"[Comparar] {codigo_base}: {resultado_comp['num_diferencias']} diferència(es) "
                                                    f"(vs {os.path.basename(ruta_anterior)})"
                                                )
                                    else:
                                        log_sse("COMPARE", f"No hi ha versió anterior de {codigo_base} — no es compara")

                            if archivo.lower().endswith(EXTENSIONES_STEP):
                                # El Excel de costos normalmente NO existe todavía cuando
                                # llega la comanda (lo crea alguien después) — se intenta
                                # igualmente por si ya estuviera, pero la pieza se muestra
                                # con el nombre de archivo como identificador principal
                                # hasta que se refresque manualmente desde la web.
                                codigo = archivo.split("-")[0].split(".")[0].strip()
                                log_sse("STEP", f"Llegint dades de l'Excel per {codigo}...")
                                ruta_excel, codigo_pdm = buscar_excel_por_codigo(codigo)
                                datos = extraer_datos_excel(ruta_excel) if ruta_excel else {}
                                if ruta_excel:
                                    log_sse("INFO", f"Excel trobat per {codigo}: {os.path.basename(ruta_excel)}")
                                    log_sse("INFO", f"Desc: {datos.get('desc', '')} | Tract: {datos.get('tract', '')} | Gruix: {datos.get('grosor', '')}")
                                else:
                                    log_sse("INFO", f"Excel no trobat per {codigo} (es mostrarà sense dades)")
                                m_base_step = RE_CODIGO_BASE_REV.match(archivo)
                                comp = comparaciones_comanda.get(m_base_step.group("base")) if m_base_step else None
                                piezas.append(PiezaResult(
                                    file=archivo,
                                    status=tipo,
                                    ref=codigo_pdm or codigo,
                                    refCliente=datos.get("ref", ""),
                                    desc=datos.get("desc", ""),
                                    tract=datos.get("tract", ""),
                                    grosor=datos.get("grosor", ""),
                                    comanda=num,
                                    excelEncontrado=bool(ruta_excel),
                                    tiene_excel=bool(ruta_excel),
                                    tiene_diferencias=(comp["tiene_diferencias"] if comp else None),
                                    num_diferencias=(comp["num_diferencias"] if comp else 0),
                                    pdf_diferencias=(os.path.basename(comp["pdf_resultado"]) if comp else ""),
                                    diferencias=(
                                        [{k: v for k, v in d.items() if k != "bbox"} for d in comp["diferencias"]]
                                        if comp else []
                                    ),
                                ))

                        log_sse("INFO", f"Total: {conteo_ext['step']} .step, {conteo_ext['pdf']} .pdf, {conteo_ext['dxf']} .dxf")

                        try:
                            shutil.rmtree(carpeta_ext)
                        except Exception:
                            pass

                    except Exception as e:
                        errores.append(f"Fallo técnico en comanda {num}: {e}")
                        log.error(f"[Descarga] Fallo técnico en comanda {num}: {e}")
                        log_sse("ERROR", f"Fallo tècnic en comanda {num}: {e}")
                        log_sse("INFO", f"Stack trace: {traceback.format_exc()}")

                browser.close()

                # Subir a la raíz todo lo que haya quedado en _TEMP (piezas
                # "nuevas" de esta descarga) — antes se dejaban ahí hasta que
                # alguien abría el STEP en SolidWorks (mover_temp_a_raiz desde
                # /abrir-solidworks); ahora se sube aquí mismo para que el
                # comparador de plànols (y el resto del portal) la vean de
                # inmediato como "la versión vigente" de esa pieza.
                log_sse("STEP", "Movent arxius nous de _TEMP a la carpeta arrel...")
                for f in list(os.listdir(CARPETA_TEMPORAL)):
                    origen = os.path.join(CARPETA_TEMPORAL, f)
                    if not os.path.isfile(origen):
                        continue
                    try:
                        shutil.move(origen, os.path.join(CARPETA_RAIZ_1076, f))
                        log_sse("FILE", f"Mogut: {f} → P:\\Fabricacio\\PLANOLS\\1076\\")
                    except Exception as e:
                        log.error(f"[Descarga] Error moviendo {f} a la raíz: {e}")
                        log_sse("ERROR", f"Error movent {f} a la raíz: {e}")
                _invalidar_cache_listado(CARPETA_RAIZ_1076)
            break  # navegador y login OK, salimos del bucle de reintento

        except Exception as e:
            log.error(f"[Descarga] Intento {intentos} fallido al lanzar navegador/login: {e}")
            log_sse("ERROR", f"Intent {intentos} fallit en llançar navegador/login: {e}")
            if intentos >= 2:
                log_sse("ERROR", f"Error de navegador/login després de {intentos} intents")
                log_sse("INFO", f"Stack trace: {traceback.format_exc()}")
                raise Exception(f"Error de navegador/login tras {intentos} intentos: {e}")
            # limpiamos lo que se hubiera dejado a medias antes de reintentar
            duplicados_sesion = []
            errores = []
            piezas = []
            limpiar_carpeta_temporal()

    if piezas:
        log_sse("STEP", "Guardant peces a l'historial...")
        añadir_piezas_al_historial(piezas)
        log_sse("OK", f"{len(piezas)} peces guardades a l'historial")
        _invalidar_cache_listado(CARPETA_RAIZ_1076)

    return DescargaResponse(ok=True, piezas=piezas, duplicados=duplicados_sesion, errores=errores)


class AutoDescargarRequest(BaseModel):
    comanda: str
    pdf_correo: Optional[str] = ""  # ruta local al PDF guardado por Outlook
    # "imprimir" (por defecto — así llama la macro real, que no manda este
    # campo) | "descargar" (toggle de Ajustos, ver _descargas_pendientes).
    # Cualquier valor que no sea "descargar" se trata como "imprimir".
    accion: Optional[str] = "imprimir"


@app.get("/config/deteccio-correu")
def get_deteccio_correu():
    """Estat del interruptor "Detectar correus en segon pla" (Ajustos)."""
    return {"activa": _deteccio_correu_activa}


class DeteccioCorreuRequest(BaseModel):
    activa: bool


@app.post("/config/deteccio-correu")
def set_deteccio_correu(req: DeteccioCorreuRequest):
    """Activa/desactiva la detecció de correu en segon pla d'aquest PC."""
    global _deteccio_correu_activa
    _deteccio_correu_activa = req.activa
    log.info(f"[Config] Detecció de correu en segon pla: {'activada' if req.activa else 'desactivada'}")
    return {"ok": True, "activa": _deteccio_correu_activa}


@app.post("/auto-descargar")
async def auto_descargar(req: AutoDescargarRequest):
    """Añade la comanda a la cola y arranca el procesador si no está corriendo."""
    global _cola_comandas, _procesando

    if not _deteccio_correu_activa:
        raise HTTPException(409, "La detecció de correu en segon pla està desactivada a Ajustos.")

    # Normalizar ruta del PDF (el VBA manda \\ escapado)
    pdf_correo = (req.pdf_correo or "").replace("\\\\", "\\").strip()
    accion = "descargar" if req.accion == "descargar" else "imprimir"
    log.info(f"[Cola] PDF correo recibido: '{pdf_correo}' — existe: {os.path.isfile(pdf_correo) if pdf_correo else 'N/A'} — accion: {accion}")

    # Evitar duplicados en cola
    ya_en_cola = any(c["comanda"] == req.comanda for c in _cola_comandas)
    if not ya_en_cola and req.comanda not in _comandas_listas:
        _cola_comandas.append({"comanda": req.comanda, "pdf_correo": pdf_correo, "accion": accion})
        log.info(f"[Cola] Comanda {req.comanda} añadida. Cola: {[c['comanda'] for c in _cola_comandas]}")

    if not _procesando:
        asyncio.create_task(_procesar_cola())

    return {"ok": True, "msg": f"Comanda {req.comanda} en cola", "cola": len(_cola_comandas)}


@app.get("/descarga-pendiente/{comanda}")
def descarga_pendiente(comanda: str):
    """Recoge el ZIP que dejó preparado el flujo automático cuando el
    toggle de Ajustos estaba en "descargar" (ver _ejecutar_auto_descarga).
    Se retira de _descargas_pendientes al servirse — solo se puede recoger
    una vez."""
    _purgar_descargas_pendientes()
    entrada = _descargas_pendientes.pop(comanda, None)
    if entrada is None:
        raise HTTPException(404, f"No hi ha cap descàrrega pendent per a la comanda {comanda}")
    _ts, zip_bytes = entrada
    return StreamingResponse(
        io.BytesIO(zip_bytes),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{comanda}_documents.zip"'},
    )


@app.get("/cola-estado")
def cola_estado():
    """Estado completo: cola, tarea actual, piezas listas para consultar."""
    return {
        "procesando": _procesando,
        "cola": [c["comanda"] for c in _cola_comandas],
        "comanda_actual": _auto_estado.get("comanda", ""),
        "fase_actual": _auto_estado.get("fase", ""),
        "piezas_listas": _piezas_listas,
        "comandas_listas": _comandas_listas,
        "hay_nuevas": len(_piezas_listas) > 0,
        "errores_recientes": _errores_recientes,
        "deteccio_activa": _deteccio_correu_activa,
    }


@app.delete("/piezas-listas")
@app.delete("/limpiar-piezas-listas")
@app.post("/limpiar-piezas-listas")
def limpiar_piezas_listas():
    """El usuario consultó las piezas — limpiar para el próximo lote."""
    global _piezas_listas, _comandas_listas
    _piezas_listas = []
    _comandas_listas = []
    return {"ok": True}


@app.post("/limpiar-errores")
def limpiar_errores():
    """El usuario descartó los errores mostrados en el ColaBadge."""
    global _errores_recientes
    _errores_recientes = []
    return {"ok": True}


@app.get("/descargar-planol/{comanda}/{nombre_archivo}")
def descargar_planol(comanda: str, nombre_archivo: str, ruta: str = ""):
    """Devuelve el plànol (PDF/DXF) de una pieza concreta desde su carpeta
    comercial P:\\Comercial\\Tavil\\<comanda>\\ — ahí es donde acaban los
    PDFs del portal + el del correo. `nombre_archivo` suele ser el nombre
    del STEP (p.ej. "1076-XXXX.step"), así que se busca por nombre base
    ignorando la extensión, ya que el plànol se guarda como .pdf/.dxf."""
    carpeta_comercial = _validar_ruta_config(ruta, "ruta_comercial", CARPETA_COMERCIAL)
    carpeta = os.path.join(carpeta_comercial, comanda)
    if not os.path.isdir(carpeta):
        raise HTTPException(404, f"No existe la carpeta comercial de la comanda {comanda}")

    base = os.path.splitext(nombre_archivo)[0]
    candidatos = sorted(
        f for f in os.listdir(carpeta)
        if os.path.splitext(f)[0] == base
        and f.lower().endswith(('.pdf', '.dxf'))
        and os.path.isfile(os.path.join(carpeta, f))
    )
    if not candidatos:
        raise HTTPException(404, f"No se encontró plànol para {nombre_archivo} en la comanda {comanda}")

    ruta = os.path.join(carpeta, candidatos[0])
    return FileResponse(ruta, filename=candidatos[0])


@app.get("/planol-diferencies/{comanda}/{nombre_archivo}")
def planol_diferencies(comanda: str, nombre_archivo: str, ruta: str = ""):
    """Devuelve el PDF de diferencias ("{codigo_base}_DIFERENCIES.pdf")
    generado por comparar_planols() para una pieza, desde su carpeta
    comercial. Igual que descargar_planol, se busca por nombre EXACTO
    dentro de os.listdir() (nunca se une la ruta directamente con el
    nombre recibido) para no abrir la puerta a path traversal."""
    carpeta_comercial = _validar_ruta_config(ruta, "ruta_comercial", CARPETA_COMERCIAL)
    carpeta = os.path.join(carpeta_comercial, comanda)
    if not os.path.isdir(carpeta):
        raise HTTPException(404, f"No existe la carpeta comercial de la comanda {comanda}")

    candidatos = [
        f for f in os.listdir(carpeta)
        if f == nombre_archivo and f.lower().endswith('.pdf') and os.path.isfile(os.path.join(carpeta, f))
    ]
    if not candidatos:
        raise HTTPException(404, f"No se encontró el PDF de diferencias: {nombre_archivo}")

    return FileResponse(os.path.join(carpeta, candidatos[0]), filename=candidatos[0])


@app.get("/descargar-todo/{comanda}")
def descargar_todo(comanda: str, ruta: str = ""):
    """Devuelve un ZIP con todos los PDFs de la carpeta comercial de una comanda."""
    carpeta_comercial = _validar_ruta_config(ruta, "ruta_comercial", CARPETA_COMERCIAL)
    carpeta = os.path.join(carpeta_comercial, comanda)
    pdfs = (
        sorted(
            f for f in os.listdir(carpeta)
            if f.lower().endswith('.pdf') and os.path.isfile(os.path.join(carpeta, f))
        )
        if os.path.isdir(carpeta)
        else []
    )
    if not pdfs:
        raise HTTPException(404, "No hi ha documents per aquesta comanda")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for f in pdfs:
            z.write(os.path.join(carpeta, f), arcname=f)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{comanda}_documents.zip"'},
    )


@app.post("/imprimir-planol/{comanda}/{nombre_archivo}")
def imprimir_planol(comanda: str, nombre_archivo: str, req: ImprimirOpcionesRequest = ImprimirOpcionesRequest()):
    """Imprime el plànol (PDF) de una pieza concreta desde su carpeta
    comercial. Solo se imprimen PDFs (SumatraPDF no imprime DXF). `req.impresora`
    es opcional — si no viene, se usa IMPRESORA (fallback)."""
    carpeta_comercial = _validar_ruta_config(req.ruta_comercial, "ruta_comercial", CARPETA_COMERCIAL)
    carpeta = os.path.join(carpeta_comercial, comanda)
    if not os.path.isdir(carpeta):
        raise HTTPException(404, f"No existe la carpeta comercial de la comanda {comanda}")

    base = os.path.splitext(nombre_archivo)[0]
    candidatos = sorted(
        f for f in os.listdir(carpeta)
        if os.path.splitext(f)[0] == base
        and f.lower().endswith('.pdf')
        and os.path.isfile(os.path.join(carpeta, f))
    )
    if not candidatos:
        raise HTTPException(404, f"No se encontró plànol para {nombre_archivo} en la comanda {comanda}")

    if not os.path.isfile(SUMATRA_EXE):
        raise HTTPException(500, f"SumatraPDF no encontrado en {SUMATRA_EXE}")

    ruta = os.path.join(carpeta, candidatos[0])
    imprimir_pdf(ruta, req.impresora)
    return {"ok": True, "file": candidatos[0]}


@app.post("/imprimir-todo/{comanda}")
def imprimir_todo(comanda: str, req: ImprimirOpcionesRequest = ImprimirOpcionesRequest()):
    """Imprime todos los PDFs de la carpeta comercial de una comanda."""
    carpeta_comercial = _validar_ruta_config(req.ruta_comercial, "ruta_comercial", CARPETA_COMERCIAL)
    carpeta = os.path.join(carpeta_comercial, comanda)
    if not os.path.isdir(carpeta):
        raise HTTPException(404, f"No existe la carpeta comercial de la comanda {comanda}")

    pdfs = sorted(
        f for f in os.listdir(carpeta)
        if f.lower().endswith('.pdf') and os.path.isfile(os.path.join(carpeta, f))
    )
    if not pdfs:
        raise HTTPException(404, f"No hay PDFs en la carpeta comercial de la comanda {comanda}")

    if not os.path.isfile(SUMATRA_EXE):
        raise HTTPException(500, f"SumatraPDF no encontrado en {SUMATRA_EXE}")

    for f in pdfs:
        imprimir_pdf(os.path.join(carpeta, f), req.impresora)
    return {"ok": True, "impresos": pdfs}


@app.post("/imprimir-comanda/{num_comanda}")
def imprimir_comanda(num_comanda: str, req: ImprimirOpcionesRequest = ImprimirOpcionesRequest()):
    """Imprime TODOS los PDFs de la carpeta comercial de una comanda con
    SumatraPDF. Usado por el botón "Imprimir documents" de las tarjetas de
    pieza que se muestran tras descargar una comanda (manual o automática).
    Misma lógica que /imprimir-todo, pero devuelve un recuento en vez de la
    lista de nombres, tal como lo pide el frontend. `req.impresora` es la
    que el usuario configuró en Ajustos — si no viene, se usa IMPRESORA."""
    carpeta_comercial = _validar_ruta_config(req.ruta_comercial, "ruta_comercial", CARPETA_COMERCIAL)
    carpeta = os.path.join(carpeta_comercial, num_comanda)
    if not os.path.isdir(carpeta):
        raise HTTPException(404, f"No existe la carpeta comercial de la comanda {num_comanda}")

    pdfs = sorted(
        f for f in os.listdir(carpeta)
        if f.lower().endswith('.pdf') and os.path.isfile(os.path.join(carpeta, f))
    )
    if not pdfs:
        raise HTTPException(404, f"No hay PDFs en la carpeta comercial de la comanda {num_comanda}")

    if not os.path.isfile(SUMATRA_EXE):
        raise HTTPException(500, f"SumatraPDF no encontrado en {SUMATRA_EXE}")

    # INTERVALO_ENTRE_IMPRESIONES entre cada PDF — ver nota en
    # _ejecutar_auto_descarga. Aquí sí se puede bloquear con time.sleep:
    # es un endpoint síncrono, FastAPI ya lo ejecuta en su propio thread.
    impresos = 0
    for i, f in enumerate(pdfs):
        if i > 0:
            time.sleep(INTERVALO_ENTRE_IMPRESIONES)
        if imprimir_pdf(os.path.join(carpeta, f), req.impresora):
            impresos += 1

    return {"ok": True, "comanda": num_comanda, "impresos": impresos, "total": len(pdfs)}


def _impresoras_via_win32print() -> list[str]:
    """Opción 1 (prioritaria): API nativa de Windows vía pywin32 — no
    depende de subprocess/shell ni de cómo el servicio (LocalSystem,
    Sesión 0) herede permisos hacia un proceso hijo, así que es la más
    fiable cuando esto corre como servicio Windows."""
    try:
        import win32print
    except ImportError:
        log.info("[Impresoras] win32print no disponible (pywin32 no instalado)")
        return []
    try:
        impresoras = [
            p[2] for p in win32print.EnumPrinters(
                win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
            )
        ]
        log.info(f"[Impresoras] win32print encontró {len(impresoras)}: {impresoras}")
        return impresoras
    except Exception as e:
        log.warning(f"[Impresoras] win32print falló: {e}")
        return []


def _impresoras_via_powershell() -> list[str]:
    """Opción 2: PowerShell Get-Printer. -NoProfile evita que intente
    cargar un perfil de usuario que no existe bajo la cuenta del
    servicio (podría colgarse o ensuciar la salida)."""
    try:
        resultado = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command",
             "Get-Printer | Select-Object -ExpandProperty Name"],
            capture_output=True, text=True, timeout=10,
        )
        impresoras = [l.strip() for l in resultado.stdout.splitlines() if l.strip()]
        log.info(
            f"[Impresoras] PowerShell Get-Printer -> rc={resultado.returncode} "
            f"stdout={resultado.stdout!r} stderr={resultado.stderr!r}"
        )
        return impresoras
    except Exception as e:
        log.warning(f"[Impresoras] PowerShell Get-Printer falló: {e}")
        return []


def _impresoras_via_wmic() -> list[str]:
    """Opción 3: wmic con encoding cp850 — wmic es texto de consola en
    la página de códigos del sistema (850 en instalaciones en español),
    no UTF-8; con el encoding por defecto de subprocess los nombres con
    acentos podían venir mal decodificados o el parseo fallar."""
    try:
        resultado = subprocess.run(
            ["wmic", "printer", "get", "name"],
            capture_output=True, encoding="cp850", timeout=10,
        )
        lineas = [l.strip() for l in resultado.stdout.splitlines() if l.strip()]
        # La primera línea no vacía es la cabecera "Name"
        impresoras = [l for l in lineas[1:] if l]
        log.info(
            f"[Impresoras] wmic (cp850) -> rc={resultado.returncode} "
            f"stdout={resultado.stdout!r} stderr={resultado.stderr!r}"
        )
        return impresoras
    except Exception as e:
        log.warning(f"[Impresoras] wmic falló: {e}")
        return []


@app.get("/impresoras")
def listar_impresoras():
    """Devuelve la lista de impresoras instaladas en el PC servidor —
    la selecciona el usuario en Ajustos y se guarda en su localStorage,
    para que cada PC use la que le corresponde al imprimir.

    Se prueban tres métodos en cascada porque, corriendo como servicio
    Windows (LocalSystem, Sesión 0), la visibilidad de impresoras puede
    diferir de una sesión interactiva normal — el primero que devuelva
    algo, se usa. Los intentos y sus resultados quedan en servidor.log
    para poder diagnosticar si ninguno encuentra nada."""
    metodos = (
        ("win32print", _impresoras_via_win32print),
        ("powershell", _impresoras_via_powershell),
        ("wmic", _impresoras_via_wmic),
    )
    for nombre, metodo in metodos:
        impresoras = metodo()
        if impresoras:
            log.info(f"[Impresoras] Usando resultado de '{nombre}': {len(impresoras)} impresora(s)")
            return {"ok": True, "impresoras": impresoras, "metodo": nombre}

    log.error("[Impresoras] Ningún método (win32print/powershell/wmic) encontró impresoras")
    return {"ok": True, "impresoras": [], "metodo": None}


def _info_excel_pieza(codigo: str) -> dict:
    """Comprueba si ya se ha creado el Excel de costos de una pieza y,
    si existe, devuelve sus datos (ref, refCliente, desc, tract, grosor,
    codigoPdm). Compartido por /refresh-pieza y /info-pieza."""
    ruta_excel, codigo_pdm = buscar_excel_por_codigo(codigo)
    if not ruta_excel:
        return {"ok": True, "encontrado": False}

    datos = extraer_datos_excel(ruta_excel)
    return {
        "ok": True,
        "encontrado": True,
        "ref": codigo_pdm or codigo,
        "codigoPdm": codigo_pdm or "",
        "refCliente": datos.get("ref", ""),
        "desc": datos.get("desc", ""),
        "tract": datos.get("tract", ""),
        "grosor": datos.get("grosor", ""),
    }


@app.get("/refresh-pieza/{codigo_pieza}")
def refresh_pieza(codigo_pieza: str):
    return _info_excel_pieza(codigo_pieza)


@app.get("/info-pieza/{codigo}")
def info_pieza(codigo: str):
    """Alias de /refresh-pieza pensado para el portal de búsqueda —
    misma respuesta, nombre más genérico."""
    return _info_excel_pieza(codigo)


@app.get("/archivo-planol-cliente/{codigo_cliente}")
def archivo_planol_cliente(codigo_cliente: str, ruta: str = ""):
    """Devuelve el plànol del cliente (PDF/DXF) como FileResponse — el
    navegador del USUARIO lo descarga/abre directamente. No usar
    os.startfile() aquí: el servidor corre como servicio Windows en el PC
    que lo aloja, así que os.startfile() solo abriría el archivo ahí, no en
    el PC del usuario que pulsó el botón.
    Busca en la raíz de fabricació (config del usuario, o CARPETA_RAIZ_1076
    por defecto) y, si aún no se ha movido ahí, en _TEMP (siempre la de
    siempre — es una carpeta interna del proceso de descarga, no depende
    de la config del usuario)."""
    carpeta_raiz = _validar_ruta_config(ruta, "ruta_planols_fabricacio", CARPETA_RAIZ_1076)
    for carpeta in (carpeta_raiz, CARPETA_TEMPORAL):
        nombre = buscar_archivo_por_prefijo(carpeta, codigo_cliente, (".pdf", ".dxf"))
        if nombre:
            return FileResponse(os.path.join(carpeta, nombre), filename=nombre)
    raise HTTPException(404, f"No se encontró plànol de cliente para {codigo_cliente}")


@app.get("/archivo-planol-taller/{codigo_pdm}")
def archivo_planol_taller(codigo_pdm: str, ruta: str = ""):
    """Devuelve nuestro plànol (PDF/DXF) que empieza por el código PDM,
    desde \\\\SRVDADES\\taller\\planols taller\\1076 (config del usuario, o
    CARPETA_TALLER por defecto), como FileResponse (mismo motivo que
    archivo_planol_cliente: debe abrirse en el PC del usuario, no en el del
    servidor)."""
    carpeta = _validar_ruta_config(ruta, "ruta_planols_taller", CARPETA_TALLER)
    nombre = buscar_archivo_por_prefijo(carpeta, codigo_pdm, (".pdf", ".dxf"))
    if not nombre:
        raise HTTPException(404, f"No se encontró plànol de taller para {codigo_pdm}")
    return FileResponse(os.path.join(carpeta, nombre), filename=nombre)


@app.get("/archivo-excel/{codigo}")
def archivo_excel(codigo: str, ruta: str = ""):
    """Devuelve el Excel de costos de una pieza como FileResponse (mismo
    motivo que archivo_planol_cliente/taller: debe abrirse en el PC del
    usuario que pulsó el botón, no en el del servidor)."""
    carpeta = _validar_ruta_config(ruta, "ruta_excels", CARPETA_EXCELS)
    ruta_excel, _ = buscar_excel_por_codigo(codigo.strip(), carpeta)
    if not ruta_excel:
        raise HTTPException(404, f"Excel no encontrado para: {codigo}")
    return FileResponse(ruta_excel, filename=os.path.basename(ruta_excel))


@app.get("/buscar")
async def buscar(
    q: str = "",
    tractament: str = "",
    grosor: str = "",
    codigo_pdm: str = "",
    codigo_cliente: str = "",
    ruta_excels: str = "",
    ruta_planols_fabricacio: str = "",
    ruta_planols_taller: str = "",
):
    """Buscador principal del portal: busca en el índice de piezas
    (construido leyendo TODOS los excels de costos) con coincidencia
    parcial por palabras — cada palabra de `q` tiene que aparecer en algún
    sitio de la pieza (código cliente, código PDM, ref. cliente,
    descripció o tractament), no necesariamente juntas ni en orden, e
    ignorando mayúsculas y acentos. También se acepta un número de comanda
    en `q`, mirando en el historial de descargas (el índice de excels no
    sabe de comandas). Los filtros son opcionales y se combinan en AND.
    `ruta_*` son la config del usuario — si no vienen (o no son válidas),
    se usan las rutas por defecto de siempre."""
    carpeta_excels = _validar_ruta_config(ruta_excels, "ruta_excels", CARPETA_EXCELS)
    carpeta_raiz = _validar_ruta_config(ruta_planols_fabricacio, "ruta_planols_fabricacio", CARPETA_RAIZ_1076)
    carpeta_taller = _validar_ruta_config(ruta_planols_taller, "ruta_planols_taller", CARPETA_TALLER)
    resultados = await _obtener_indice_para_ruta(carpeta_excels)

    if codigo_pdm.strip():
        cp = _normalizar(codigo_pdm)
        resultados = [p for p in resultados if cp in _normalizar(p["codigoPdm"])]
    if codigo_cliente.strip():
        cc = _normalizar(codigo_cliente)
        resultados = [p for p in resultados if cc in _normalizar(p["codigoCliente"])]
    if tractament.strip():
        t = _normalizar(tractament)
        resultados = [p for p in resultados if t in _normalizar(p["tract"])]
    if grosor.strip():
        g = _normalizar(grosor)
        resultados = [p for p in resultados if g in _normalizar(p["grosor"])]

    q = q.strip()
    if q:
        palabras = [_normalizar(w) for w in q.split() if w]
        codigos_por_comanda = _codigos_cliente_por_comanda(q)
        q_norm = _normalizar(q)
        con_score = []
        for p in resultados:
            texto = _normalizar(
                f"{p['codigoCliente']} {p['codigoPdm']} {p['refCliente']} {p['desc']} {p['tract']}"
            )
            coincide_comanda = p["codigoCliente"] in codigos_por_comanda
            if not coincide_comanda and not all(palabra in texto for palabra in palabras):
                continue
            if q_norm in (_normalizar(p["codigoCliente"]), _normalizar(p["codigoPdm"])):
                score = 0  # coincidencia exacta de código
            elif coincide_comanda:
                score = 1  # coincide por número de comanda
            elif q_norm in texto:
                score = 2  # la frase completa aparece tal cual
            else:
                score = 3  # solo coinciden las palabras sueltas
            con_score.append((score, p["codigoCliente"], p))
        con_score.sort(key=lambda x: (x[0], x[1]))
        resultados = [p for _, _, p in con_score]
    else:
        # Sin texto de búsqueda (solo filtros) no hay relevancia que
        # ordenar — se ordena por código cliente para que el corte sea
        # determinista en vez de depender del orden arbitrario de
        # os.listdir(), que podría dejar fuera piezas reales del filtro
        # (p.ej. un grosor muy común como "3mm" puede tener cientos de
        # piezas — sin este orden, cuál de ellas entra en el corte cambia
        # cada reindexado).
        resultados = sorted(resultados, key=lambda p: p["codigoCliente"])

    total = len(resultados)
    resultados = resultados[:500]

    # Disponibilidad de plànols — con hasta 500 resultados, comprobar cada
    # uno con buscar_archivo_por_prefijo (un escaneo del listado completo
    # por pieza) es O(resultados × archivos) — con la carpeta raíz de
    # ~28.000 archivos eso son hasta 14 millones de comparaciones y se
    # nota. En su lugar se construye UNA VEZ el conjunto de códigos que sí
    # tienen plànol y se hacen comprobaciones O(1) por pieza.
    codigos_planol_cliente = _codigos_con_planol(carpeta_raiz)
    codigos_planol_taller = _codigos_con_planol(carpeta_taller)
    salida = [
        {
            **p,
            "planolCliente": p["codigoCliente"].lower() in codigos_planol_cliente,
            "planolTaller": p["codigoPdm"].lower() in codigos_planol_taller,
        }
        for p in resultados
    ]

    # `total` permite al frontend avisar "mostrando 500 de 1085 — afina la
    # búsqueda" cuando el filtro por sí solo da más resultados de los que
    # se devuelven.
    return {"resultados": salida, "total": total}


@app.get("/filtros-disponibles")
async def filtros_disponibles(ruta_excels: str = ""):
    """Valores únicos de tractament y grosor del índice, para rellenar los
    desplegables de filtro. `ruta_excels` es la config del usuario — si no
    viene (o no es válida), se usa CARPETA_EXCELS."""
    carpeta = _validar_ruta_config(ruta_excels, "ruta_excels", CARPETA_EXCELS)
    indice = await _obtener_indice_para_ruta(carpeta)
    tractaments = sorted({p["tract"] for p in indice if p["tract"]})
    grosores = sorted({p["grosor"] for p in indice if p["grosor"]})
    return {"tractaments": tractaments, "grosores": grosores}


@app.get("/reindexar")
async def reindexar(ruta_excels: str = ""):
    """Fuerza la reconstrucción del índice de piezas. No bloquea — arranca
    en segundo plano y devuelve al momento. `ruta_excels` es la config del
    usuario — si no viene (o no es válida), reindexa la ruta por defecto."""
    carpeta = _validar_ruta_config(ruta_excels, "ruta_excels", CARPETA_EXCELS)
    if carpeta == CARPETA_EXCELS:
        if _indexando:
            return {"ok": True, "estado": "ya_en_curso", "total": len(_INDICE_PIEZAS)}
        asyncio.create_task(_reindexar_async())
        return {"ok": True, "estado": "iniciado", "total_actual": len(_INDICE_PIEZAS)}
    else:
        if carpeta in _indexando_alt:
            return {"ok": True, "estado": "ya_en_curso", "total": len(_indices_alt.get(carpeta, []))}
        asyncio.create_task(_construir_indice_alt_async(carpeta))
        return {"ok": True, "estado": "iniciado", "total_actual": len(_indices_alt.get(carpeta, []))}


@app.get("/indice-estado")
def indice_estado():
    """Estat NOMÉS-lectura de l'índex per defecte (no en dispara cap
    reindexat) -- el fa servir el frontend per fer polling després de
    prémer "Actualitzar índex" al cercador i saber quan el reindexat en
    curs (/reindexar) ha acabat, per poder refer la cerca automàticament."""
    return {"indexando": _indexando, "total": len(_INDICE_PIEZAS), "ultimo_indexado": _ultimo_indexado}


# =====================================================================
# ANULADOR — réplica web de dos scripts que antes se ejecutaban a mano:
#   C:\DXF TEMPORAL\Programacio\ANULAR PLANOLS\planols.py
#   C:\DXF TEMPORAL\Programacio\ANULAR GEOS\anular.py
# Ambos operan sobre la misma carpeta (P:\Fabricacio\PLANOLS\1076, aquí
# CARPETA_RAIZ_1076 en UNC) pero agrupan tipos de archivo distintos:
#   - planols.py: .stp/.pdf/.dxf con patrón "NUMERO-NUMERO_REVxx...ext" —
#     se queda con la REV más alta por pieza y marca las demás.
#   - anular.py:  .geo con patrón "1076NUMERO_vN.geo" — se queda con la
#     versión (v) más alta por código y marca las demás.
# Los dos anteponen el prefijo "--ANUL·LAT--" al nombre de los archivos
# que hay que anular, en vez de borrarlos.
# =====================================================================
ANUL_PREFIX = "--ANUL·LAT--"

# Estructura real: cada pieza tiene hasta 3 archivos con el mismo código
# base ("NUMERO-NUMERO") y la misma revisión ("_REVnn"):
#   10142247-10142247_REV01.pdf / .dxf / .stp
# Cuando aparece una revisión nueva (_REV02...), la agrupación es por
# CÓDIGO BASE (no por extensión) — todos los archivos de una revisión que
# no sea la más alta son candidatos a anular, sin importar si son pdf, dxf
# o step/stp. En producción casi todos son ".stp"; ".step" se admite igual
# por si acaso.
EXTENSIONES_ANULADOR_PLANOLS = {".pdf", ".dxf", ".stp", ".step"}
RE_BASE_REV = re.compile(
    r"^(\d+-\d+)_REV(\d+)\.(pdf|dxf|stp|step)$", re.IGNORECASE
)

PREFIJO_CODIGO_GEO = "1076"
EXTENSION_GEO = ".geo"
PATRON_GEO = re.compile(r"^(?P<codigo>1076\d+)_v(?P<version>\d+)\.geo$", re.IGNORECASE)


def _parse_nombre_planol(nombre: str) -> Optional[dict]:
    """Extrae base_id/revisión/extensión de un nombre de archivo de plànol.
    Admite el prefijo --ANUL·LAT-- ya puesto (para saber que ese archivo no
    es candidato, pero su revisión sigue contando a la hora de calcular
    cuál es la revisión más alta del código). Devuelve None si el nombre no
    encaja con el patrón "NUMERO-NUMERO_REVnn.ext" (para no tocar archivos
    raros)."""
    anulado_previamente = nombre.startswith(ANUL_PREFIX)
    nombre_sin_anul = nombre[len(ANUL_PREFIX):] if anulado_previamente else nombre

    m = RE_BASE_REV.match(nombre_sin_anul)
    if not m:
        return None

    return {
        "nombre": nombre,
        "base_id": m.group(1),
        "rev": int(m.group(2)),
        "ext": m.group(3).lower(),
        "anulado": anulado_previamente,
    }


def _agrupar_archivos_planols(carpeta: str = None) -> dict[str, list[dict]]:
    """Escanea la carpeta y agrupa los archivos de plànol reconocidos por
    código base. Función compartida por el escaneo de candidatos (rojo,
    la misma que usa la ejecución real) y por la vista completa
    (rojo + verde) que consume el portal."""
    carpeta = carpeta or CARPETA_RAIZ_1076
    if not os.path.isdir(carpeta):
        return {}
    archivos_info = []
    with os.scandir(carpeta) as it:
        for entry in it:
            if not entry.is_file():
                continue
            info = _parse_nombre_planol(entry.name)
            if info is not None:
                archivos_info.append(info)
    grupos: dict[str, list[dict]] = {}
    for info in archivos_info:
        grupos.setdefault(info["base_id"], []).append(info)
    return grupos


def _escanear_anulador_planols(carpeta: str = None) -> list[dict]:
    """Candidatos a anular (rojo): para cada código base, todos los
    archivos (pdf/dxf/step) de una revisión inferior a la más alta que
    todavía no lleven --ANUL·LAT--. Es la lista que se renombra de
    verdad al ejecutar (POST /anulador/ejecutar-planols) — no toca los
    "correcte" (verde)."""
    grupos = _agrupar_archivos_planols(carpeta)
    candidatos = []
    for base_id, items in grupos.items():
        revision_activa = max(i["rev"] for i in items)
        for info in items:
            if info["rev"] >= revision_activa:
                continue  # es la revisión activa (o empata con ella) -> se mantiene tal cual
            if info["anulado"]:
                continue  # ya lleva --ANUL·LAT-- -> nada que hacer
            candidatos.append({
                "base_id": base_id,
                "ext": info["ext"],
                "revision": info["rev"],
                "revision_activa": revision_activa,
                "archivo_actual": info["nombre"],
                "archivo_nuevo": ANUL_PREFIX + info["nombre"],
                "estado": "anular",
            })
    candidatos.sort(key=lambda x: (x["base_id"], x["revision"], x["ext"]))
    return candidatos


def _vista_anulador_planols(carpeta: str = None) -> list[dict]:
    """Rojo + verde para pintar en el portal: para cada código base que
    tenga al menos un candidato a anular, incluye también el/los archivo/s
    de la revisión activa (verde, "correcte") junto a lo que se va a
    anular. Los códigos sin ningún candidato (una sola revisión, o ya todo
    anulado) no se muestran — no hay nada que decidir."""
    grupos = _agrupar_archivos_planols(carpeta)
    items = []
    for base_id, group in grupos.items():
        revision_activa = max(i["rev"] for i in group)
        no_anulados = [i for i in group if not i["anulado"]]
        hay_candidatos = any(i["rev"] < revision_activa for i in no_anulados)
        if not hay_candidatos:
            continue
        for info in no_anulados:
            estado = "anular" if info["rev"] < revision_activa else "correcte"
            items.append({
                "base_id": base_id,
                "ext": info["ext"],
                "revision": info["rev"],
                "revision_activa": revision_activa,
                "archivo_actual": info["nombre"],
                "archivo_nuevo": ANUL_PREFIX + info["nombre"],
                "estado": estado,
            })
    items.sort(key=lambda x: (x["base_id"], x["revision"], x["ext"]))
    return items


def _agrupar_archivos_geo(carpeta: str = None) -> dict[str, list[tuple[int, str]]]:
    """Escanea la carpeta y agrupa los .geo válidos (empiezan por 1076,
    formato <codigo>_vN.geo, todavía no anulados) por código. Función
    compartida por el escaneo de candidatos y la vista completa."""
    carpeta = carpeta or CARPETA_RAIZ_1076
    if not os.path.isdir(carpeta):
        return {}
    grupos: dict[str, list[tuple[int, str]]] = {}
    with os.scandir(carpeta) as it:
        for entry in it:
            if not entry.is_file():
                continue
            nombre = entry.name
            if nombre.startswith(ANUL_PREFIX):
                continue
            if not nombre.startswith(PREFIJO_CODIGO_GEO):
                continue
            if not nombre.lower().endswith(EXTENSION_GEO):
                continue
            m = PATRON_GEO.match(nombre)
            if not m:
                continue
            grupos.setdefault(m.group("codigo"), []).append((int(m.group("version")), nombre))
    return grupos


def _escanear_anulador_geos(carpeta: str = None) -> list[dict]:
    """Candidatos a anular (rojo): todas las versiones anteriores a la más
    alta, para códigos con más de una versión. Es la lista que se renombra
    de verdad al ejecutar (POST /anulador/ejecutar-geos)."""
    grupos = _agrupar_archivos_geo(carpeta)
    pendientes = []
    for codigo, versiones in grupos.items():
        if len(versiones) < 2:
            continue  # solo una versión -> nada que anular
        versiones_ordenadas = sorted(versiones, key=lambda v: v[0])
        activa = versiones_ordenadas[-1]
        for tupla in versiones_ordenadas[:-1]:
            version_num, nombre = tupla
            pendientes.append({
                "codigo": codigo,
                "version": version_num,
                "version_activa": activa[0],
                "archivo_actual": nombre,
                "archivo_nuevo": ANUL_PREFIX + nombre,
                "estado": "anular",
            })
    pendientes.sort(key=lambda x: (x["codigo"], x["version"]))
    return pendientes


def _vista_anulador_geos(carpeta: str = None) -> list[dict]:
    """Rojo + verde: para códigos con más de una versión, incluye también
    la versión activa (verde, "correcte") junto a las que se van a
    anular."""
    grupos = _agrupar_archivos_geo(carpeta)
    items = []
    for codigo, versiones in grupos.items():
        if len(versiones) < 2:
            continue
        versiones_ordenadas = sorted(versiones, key=lambda v: v[0])
        activa = versiones_ordenadas[-1]
        for tupla in versiones_ordenadas:
            version_num, nombre = tupla
            estado = "correcte" if tupla == activa else "anular"
            items.append({
                "codigo": codigo,
                "version": version_num,
                "version_activa": activa[0],
                "archivo_actual": nombre,
                "archivo_nuevo": ANUL_PREFIX + nombre,
                "estado": estado,
            })
    items.sort(key=lambda x: (x["codigo"], x["version"]))
    return items


@app.get("/anulador/planols")
def anulador_planols():
    """Lista los archivos de plànol (.pdf/.dxf/.stp) relevantes para
    decidir: en rojo ("anular") los que pertenecen a una revisión que NO
    es la más alta de su código de pieza y todavía no llevan
    --ANUL·LAT--, y en verde ("correcte") la revisión que se mantiene.
    `total` cuenta solo los candidatos en rojo (los que se anularían)."""
    try:
        items = _vista_anulador_planols()
    except Exception as e:
        raise HTTPException(500, f"Error escaneando plànols: {e}")
    total = sum(1 for i in items if i["estado"] == "anular")
    return {"ok": True, "items": items, "total": total}


@app.get("/anulador/geos")
def anulador_geos():
    """Lista los .geo relevantes para decidir: en rojo ("anular") las
    versiones anteriores a la más alta y en verde ("correcte") la versión
    que se mantiene, para códigos con más de una versión (misma lógica
    que ANULAR GEOS/anular.py). `total` cuenta solo los candidatos en
    rojo."""
    try:
        items = _vista_anulador_geos()
    except Exception as e:
        raise HTTPException(500, f"Error escaneando geos: {e}")
    total = sum(1 for i in items if i["estado"] == "anular")
    return {"ok": True, "items": items, "total": total}


@app.post("/anulador/ejecutar-planols")
def anulador_ejecutar_planols():
    """Renombra cada archivo candidato (pdf/dxf/stp de una revisión que no
    es la activa, en rojo) anteponiendo --ANUL·LAT--. Nunca toca los
    "correcte" (verde). Idempotente: si el destino ya existe (p.ej. la
    lista mostrada al usuario quedó desactualizada), añade un sufijo
    __dupN en vez de sobrescribir."""
    carpeta = CARPETA_RAIZ_1076
    try:
        pendientes = _escanear_anulador_planols(carpeta)
    except Exception as e:
        raise HTTPException(500, f"Error escaneando plànols: {e}")

    aplicados = 0
    errores = []
    for item in pendientes:
        origen = os.path.join(carpeta, item["archivo_actual"])
        destino = os.path.join(carpeta, item["archivo_nuevo"])
        destino_final = destino
        contador = 1
        while os.path.exists(destino_final) and destino_final != origen:
            base, ext = os.path.splitext(destino)
            destino_final = f"{base}__dup{contador}{ext}"
            contador += 1
        try:
            os.rename(origen, destino_final)
            aplicados += 1
        except OSError as e:
            errores.append(f"{item['archivo_actual']}: {e}")

    _invalidar_cache_listado(carpeta)
    log.info(f"[Anulador] Plànols anulados: {aplicados}/{len(pendientes)}")
    return {"ok": True, "anulados": aplicados, "total": len(pendientes), "errores": errores}


@app.post("/anulador/ejecutar-geos")
def anulador_ejecutar_geos():
    """Aplica el renombrado --ANUL·LAT-- a las versiones antiguas de .geo
    en rojo (lo que hace anular.py al confirmar con "s"). Nunca toca la
    versión activa (verde)."""
    carpeta = CARPETA_RAIZ_1076
    try:
        pendientes = _escanear_anulador_geos(carpeta)
    except Exception as e:
        raise HTTPException(500, f"Error escaneando geos: {e}")

    aplicados = 0
    errores = []
    for item in pendientes:
        origen = os.path.join(carpeta, item["archivo_actual"])
        destino = os.path.join(carpeta, item["archivo_nuevo"])
        if os.path.exists(destino):
            errores.append(f"{item['archivo_actual']}: ya existe '{item['archivo_nuevo']}'")
            continue
        try:
            os.rename(origen, destino)
            aplicados += 1
        except OSError as e:
            errores.append(f"{item['archivo_actual']}: {e}")

    _invalidar_cache_listado(carpeta)
    log.info(f"[Anulador] Geos anulados: {aplicados}/{len(pendientes)}")
    return {"ok": True, "anulados": aplicados, "total": len(pendientes), "errores": errores}


# =====================================================================
# ANULADOR — PROGRAMES DE TRUBEND (M:\TruBend5085\1076 y M:\TruBend5230\1076)
# =====================================================================
# NOTA sobre las rutas: "M:\..." es una unidad de red mapeada (net use),
# solo visible en la sesión interactiva del usuario que la mapeó — el
# servicio Windows (LocalSystem) NO la ve, exactamente igual que P:\ (ver
# nota de CARPETA_RAIZ_1076 al principio del archivo). El UNC real
# equivalente, confirmado con `net use`, es \\TRUMPFSRV\Maquinas\...
#
# NOTA sobre el prefijo de anulados: estas carpetas llevan años de gente
# marcando archivos "anulados" a mano, con convenciones distintas cada vez
# (--ANUL.LAT-- con punto, "_v0--ANUL·LAT--" como sufijo, "_v0 - ANUL·LAT",
# etc. — se comprobó el contenido real de ambas carpetas antes de escribir
# esto). Ninguna de esas variantes encaja con el patrón estricto de abajo
# (PATRON_PROGRAMA, anclado a "^1076...vN.ext$"), así que quedan ignoradas
# sin más — ni se tocan ni se listan como pendientes, igual que cualquier
# archivo con un nombre raro en plànols/geos. Los NUEVOS anulados que haga
# esta herramienta usan el mismo prefijo que plànols/geos (ANUL_PREFIX,
# "--ANUL·LAT--" con punto medio) para que las tres columnas sean
# consistentes de aquí en adelante.
CARPETAS_PROGRAMES = {
    "5085": r"\\TRUMPFSRV\Maquinas\TruBend5085\1076",
    "5230": r"\\TRUMPFSRV\Maquinas\TruBend5230\1076",
}
PATRON_PROGRAMA = re.compile(r"^(?P<codigo>1076\d+)_v(?P<version>\d+)\.(?P<ext>bmt|jupidu)$", re.IGNORECASE)


def _agrupar_archivos_programa(carpeta: str) -> dict[tuple[str, int], list[str]]:
    """Escanea `carpeta` y agrupa los .bmt/.jupidu válidos (patrón estricto
    "<codigo>_v<version>.ext", empezando por 1076, sin --ANUL·LAT-- ya
    puesto) por (código, versión). Cada grupo puede tener 1 o 2 archivos —
    en producción no todos los programas tienen ambos (.bmt sin .jupidu es
    habitual)."""
    if not os.path.isdir(carpeta):
        return {}
    grupos: dict[tuple[str, int], list[str]] = {}
    with os.scandir(carpeta) as it:
        for entry in it:
            if not entry.is_file():
                continue
            nombre = entry.name
            if nombre.startswith(ANUL_PREFIX):
                continue
            m = PATRON_PROGRAMA.match(nombre)
            if not m:
                continue
            clave = (m.group("codigo"), int(m.group("version")))
            grupos.setdefault(clave, []).append(nombre)
    return grupos


def _versiones_por_codigo(grupos: dict[tuple[str, int], list[str]]) -> dict[str, list[int]]:
    por_codigo: dict[str, list[int]] = {}
    for codigo, version in grupos:
        por_codigo.setdefault(codigo, []).append(version)
    return por_codigo


def _escanear_anulador_programa_carpeta(label: str, carpeta: str) -> list[dict]:
    """Candidatos a anular (rojo) de UNA carpeta/máquina: para cada código
    con más de una versión, todas las versiones anteriores a la más alta.
    Cada item representa un programa (código+versión), con su lista de
    archivos (.bmt y/o .jupidu) — es la lista que se renombra de verdad al
    ejecutar."""
    grupos = _agrupar_archivos_programa(carpeta)
    por_codigo = _versiones_por_codigo(grupos)
    pendientes = []
    for codigo, versiones in por_codigo.items():
        if len(versiones) < 2:
            continue
        version_activa = max(versiones)
        for version in versiones:
            if version >= version_activa:
                continue
            archivos = sorted(grupos[(codigo, version)])
            pendientes.append({
                "codigo": codigo,
                "version": version,
                "version_activa": version_activa,
                "archivos": archivos,
                "archivos_nuevos": [ANUL_PREFIX + a for a in archivos],
                "carpeta": label,
                "estado": "anular",
            })
    pendientes.sort(key=lambda x: (x["carpeta"], x["codigo"], x["version"]))
    return pendientes


def _vista_anulador_programa_carpeta(label: str, carpeta: str) -> list[dict]:
    """Rojo + verde de UNA carpeta/máquina: para códigos con más de una
    versión, incluye también la versión activa (verde, "correcte")."""
    grupos = _agrupar_archivos_programa(carpeta)
    por_codigo = _versiones_por_codigo(grupos)
    items = []
    for codigo, versiones in por_codigo.items():
        if len(versiones) < 2:
            continue
        version_activa = max(versiones)
        for version in versiones:
            archivos = sorted(grupos[(codigo, version)])
            estado = "correcte" if version == version_activa else "anular"
            items.append({
                "codigo": codigo,
                "version": version,
                "version_activa": version_activa,
                "archivos": archivos,
                "archivos_nuevos": [ANUL_PREFIX + a for a in archivos],
                "carpeta": label,
                "estado": estado,
            })
    items.sort(key=lambda x: (x["carpeta"], x["codigo"], x["version"]))
    return items


@app.get("/anulador/programes")
def anulador_programes():
    """Lista los programes de TruBend (.bmt/.jupidu) de las dos máquinas
    (5085 y 5230): en rojo ("anular") las versiones anteriores a la más
    alta y en verde ("correcte") la que se mantiene, para códigos con más
    de una versión, por separado en cada carpeta (misma pieza en 5085 y
    5230 son programas independientes). `errores` lista qué carpeta(s) no
    se han podido leer (no accesible / no existe), para que el frontend
    muestre un aviso claro en vez de una lista vacía sin explicación."""
    items: list[dict] = []
    errores: list[str] = []
    for label, carpeta in CARPETAS_PROGRAMES.items():
        if not os.path.isdir(carpeta):
            errores.append(f"No s'ha pogut accedir a la carpeta {label} ({carpeta})")
            log.warning(f"[Anulador] Carpeta de programes {label} no accessible: {carpeta}")
            continue
        try:
            items.extend(_vista_anulador_programa_carpeta(label, carpeta))
        except Exception as e:
            errores.append(f"Error escanejant {label}: {e}")
            log.error(f"[Anulador] Error escaneando programes {label} ({carpeta}): {e}")
    total = sum(1 for i in items if i["estado"] == "anular")
    return {"ok": True, "items": items, "total": total, "errores": errores}


@app.post("/anulador/ejecutar-programes")
def anulador_ejecutar_programes():
    """Renombra, para cada programa candidato (código+versión que no es la
    activa, en rojo) de las dos carpetas, TODOS sus archivos (.bmt y/o
    .jupidu) anteponiendo --ANUL·LAT--. Nunca toca los "correcte" (verde).
    Idempotente igual que plànols/geos: si el destino ya existe, añade un
    sufijo __dupN en vez de sobrescribir. `anulados`/`total` cuentan
    ARCHIVOS renombrados (un programa puede tener 1 o 2)."""
    aplicados = 0
    total_archivos = 0
    errores: list[str] = []

    for label, carpeta in CARPETAS_PROGRAMES.items():
        if not os.path.isdir(carpeta):
            errores.append(f"No s'ha pogut accedir a la carpeta {label} ({carpeta})")
            continue
        try:
            pendientes = _escanear_anulador_programa_carpeta(label, carpeta)
        except Exception as e:
            errores.append(f"Error escanejant {label}: {e}")
            continue

        for item in pendientes:
            for nombre in item["archivos"]:
                total_archivos += 1
                origen = os.path.join(carpeta, nombre)
                destino = os.path.join(carpeta, ANUL_PREFIX + nombre)
                destino_final = destino
                contador = 1
                while os.path.exists(destino_final) and destino_final != origen:
                    base, ext = os.path.splitext(destino)
                    destino_final = f"{base}__dup{contador}{ext}"
                    contador += 1
                try:
                    os.rename(origen, destino_final)
                    aplicados += 1
                except OSError as e:
                    errores.append(f"{label}/{nombre}: {e}")

    log.info(f"[Anulador] Programes anulados: {aplicados}/{total_archivos} arxius")
    return {"ok": True, "anulados": aplicados, "total": total_archivos, "errores": errores}


# =====================================================================
# COMPARADOR DE PLÀNOLS — compara la revisión recién descargada de un
# plànol contra la revisión anterior (vigente o ya anulada) del mismo
# código, en dos frentes:
#   1. Cotas numéricas: extrae los tokens de texto que parecen una cota
#      (RE_TOKEN_COTA) con su posición, empareja por proximidad (radio =
#      5% de la diagonal de la página) y marca cambiadas/nuevas/eliminadas.
#   2. Vista 3D/isométrica: detecta la zona con más densidad de píxeles
#      oscuros en el cuadrante inferior izquierdo (donde suele ir la
#      axonometría) y la compara píxel a píxel entre ambas revisiones.
# Genera un PDF con las marcas sobre la revisión NUEVA. Nunca debe tumbar
# la descarga si algo falla — comparar_planols() blinda todos sus pasos
# y devuelve None en vez de propagar la excepción.
# =====================================================================
RE_CODIGO_BASE_REV = re.compile(r"^(?P<base>\d+-\d+)_REV(?P<rev>\d+)", re.IGNORECASE)
RE_TOKEN_COTA = re.compile(
    r"^[RØ∅⌀]?\s*[-+]?\d+(?:[.,]\d+)?\s*(?:°|mm|cm|m|\"|R|Ø|∅|⌀)?$"
)
RADIO_COMPARACION_PCT = 0.05   # 5% de la diagonal de la página
ZOOM_RENDER_COMPARADOR = 1.5   # factor de renderizado PDF -> imagen para la zona 3D
UMBRAL_OSCURO_3D = 150         # 0-255, por debajo se considera "línea de dibujo"
UMBRAL_DIFERENCIA_3D = 0.02    # proporción de píxeles distintos para considerar cambio


def _buscar_planol_anterior(carpeta: str, codigo_base: str, rev_excluir: int) -> Optional[str]:
    """Busca en `carpeta` el PDF de mayor revisión con ese código base que
    NO sea `rev_excluir` (la que se acaba de descargar) — incluye tanto
    vigentes como ya anulados (--ANUL·LAT--), porque en producción el
    Anulador ya se encarga de que solo quede una revisión vigente por
    código: la "anterior" casi siempre está anulada, no coexistiendo."""
    mejor_rev, mejor_ruta = -1, None
    try:
        with os.scandir(carpeta) as it:
            for entry in it:
                if not entry.is_file():
                    continue
                nombre = entry.name
                if not nombre.lower().endswith(".pdf"):
                    continue
                base_sin_anul = nombre[len(ANUL_PREFIX):] if nombre.startswith(ANUL_PREFIX) else nombre
                m = RE_CODIGO_BASE_REV.match(base_sin_anul)
                if not m or m.group("base") != codigo_base:
                    continue
                rev = int(m.group("rev"))
                if rev == rev_excluir:
                    continue
                if rev > mejor_rev:
                    mejor_rev, mejor_ruta = rev, entry.path
    except Exception as e:
        log.error(f"[Comparar] Error buscando revisión anterior de {codigo_base}: {e}")
    return mejor_ruta


def _extraer_tokens_cota(pdf_path: str) -> list[dict]:
    """Tokens de texto de la primera página que encajan con RE_TOKEN_COTA,
    con su posición (centro del bbox) y el bbox original."""
    tokens = []
    doc = fitz.open(pdf_path)
    try:
        if doc.page_count == 0:
            return []
        blocks = doc[0].get_text("dict")["blocks"]
        for block in blocks:
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    texto = span["text"].strip()
                    if not texto or not RE_TOKEN_COTA.match(texto):
                        continue
                    x0, y0, x1, y1 = span["bbox"]
                    tokens.append({
                        "texto": texto,
                        "x": (x0 + x1) / 2, "y": (y0 + y1) / 2,
                        "bbox": (x0, y0, x1, y1),
                    })
    finally:
        doc.close()
    return tokens


def _diagonal_pagina(pdf_path: str) -> float:
    doc = fitz.open(pdf_path)
    try:
        if doc.page_count == 0:
            return 1000.0
        r = doc[0].rect
        return (r.width ** 2 + r.height ** 2) ** 0.5
    finally:
        doc.close()


def _normalizar_cota(texto: str) -> str:
    """Para que "12,5" y "12.5" cuenten como la misma cota."""
    return texto.strip().replace(",", ".")


def _comparar_cotas(tokens_orig: list[dict], tokens_nuevo: list[dict], diagonal: float) -> list[dict]:
    """Empareja cada token nuevo con el token original más cercano dentro
    del radio (5% de la diagonal); si el texto difiere -> "cambiat". Los
    tokens nuevos sin pareja -> "nou". Los originales que se quedan sin
    pareja -> "eliminat"."""
    radio = diagonal * RADIO_COMPARACION_PCT
    usados_orig: set[int] = set()
    diferencias = []

    for tn in tokens_nuevo:
        mejor_i, mejor_dist = None, radio
        for i, to in enumerate(tokens_orig):
            if i in usados_orig:
                continue
            dist = ((tn["x"] - to["x"]) ** 2 + (tn["y"] - to["y"]) ** 2) ** 0.5
            if dist <= mejor_dist:
                mejor_dist, mejor_i = dist, i
        if mejor_i is not None:
            usados_orig.add(mejor_i)
            to = tokens_orig[mejor_i]
            if _normalizar_cota(to["texto"]) != _normalizar_cota(tn["texto"]):
                diferencias.append({
                    "tipo": "cambiat", "valor_anterior": to["texto"], "valor_nou": tn["texto"],
                    "bbox": tn["bbox"],
                })
        else:
            diferencias.append({"tipo": "nou", "valor_nou": tn["texto"], "bbox": tn["bbox"]})

    for i, to in enumerate(tokens_orig):
        if i not in usados_orig:
            diferencias.append({"tipo": "eliminat", "valor_anterior": to["texto"], "bbox": to["bbox"]})

    return diferencias


def _render_pagina_gris(pdf_path: str) -> Image.Image:
    doc = fitz.open(pdf_path)
    try:
        page = doc[0]
        pix = page.get_pixmap(matrix=fitz.Matrix(ZOOM_RENDER_COMPARADOR, ZOOM_RENDER_COMPARADOR), colorspace=fitz.csGRAY)
        return Image.frombytes("L", (pix.width, pix.height), pix.samples)
    finally:
        doc.close()


def _detectar_zona_3d(img: Image.Image) -> tuple[int, int, int, int]:
    """Busca en TODA la página la ventana con más densidad de píxeles
    oscuros — reduciendo la página a una rejilla pequeña para que la
    búsqueda por fuerza bruta sea barata. Devuelve el bbox en píxeles de
    `img`.

    NOTA: la especificación original acotaba esto al cuadrante inferior
    izquierdo (donde "suele" ir la vista isométrica), pero probado contra
    plànols reales de producción la posición varía según la plantilla —
    en unos está abajo-izquierda, en otros arriba-derecha. La vista
    isométrica/3D es, en cualquier posición, la región más "sólida" (más
    oscura de media) de la página frente a las vistas acotadas de líneas
    finas, así que buscar en toda la página generaliza correctamente sin
    depender de dónde la haya puesto quien dibujó esa pieza en concreto."""
    ancho, alto = img.size
    celdas = 40
    peq = img.resize((celdas, celdas), Image.BILINEAR)
    oscuros = [1 if p < UMBRAL_OSCURO_3D else 0 for p in peq.getdata()]

    tam_ventana = max(4, int(celdas * 0.28))  # tamaño típico de la vista 3D observado en plànols reales
    mejor_suma, mejor_pos = -1, (0, 0)
    for fy in range(0, celdas - tam_ventana + 1):
        for fx in range(0, celdas - tam_ventana + 1):
            suma = 0
            for yy in range(fy, fy + tam_ventana):
                base = yy * celdas
                suma += sum(oscuros[base + fx: base + fx + tam_ventana])
            if suma > mejor_suma:
                mejor_suma, mejor_pos = suma, (fx, fy)

    fx, fy = mejor_pos
    esc_x, esc_y = ancho / celdas, alto / celdas
    return (
        int(fx * esc_x), int(fy * esc_y),
        int((fx + tam_ventana) * esc_x), int((fy + tam_ventana) * esc_y),
    )


def _comparar_zona_3d(img_orig: Image.Image, img_nuevo: Image.Image, bbox: tuple[int, int, int, int]) -> float:
    """Compara píxel a píxel (tras normalizar tamaño a 150x150) la región
    `bbox` de ambas imágenes. Devuelve la PROPORCIÓN de píxeles distintos
    (0.0-1.0) — quien llama decide el umbral (UMBRAL_DIFERENCIA_3D) y así
    puede loguear el porcentaje real, no solo un booleano."""
    tam = (150, 150)
    r_orig = img_orig.crop(bbox).resize(tam, Image.BILINEAR)
    r_nuevo = img_nuevo.crop(bbox).resize(tam, Image.BILINEAR)
    px_o, px_n = list(r_orig.getdata()), list(r_nuevo.getdata())
    distintos = sum(1 for a, b in zip(px_o, px_n) if abs(a - b) > 40)
    return distintos / len(px_o)


def _generar_pdf_diferencias(
    pdf_nuevo_path: str,
    diferencias: list[dict],
    zona_3d: Optional[tuple[int, int, int, int]],
    hay_diff_3d: bool,
    ruta_salida: str,
):
    """Dibuja las marcas sobre una copia de pdf_nuevo_path y la guarda en
    ruta_salida: rectángulo rojo + "Era: X" para cotas cambiadas, verde
    para nuevas, naranja discontinuo + "Eliminat: X" (en su posición
    original) para las que ya no están, y un overlay rojo semitransparente
    sobre la zona 3D si hay cambios visuales ahí."""
    doc = fitz.open(pdf_nuevo_path)
    try:
        page = doc[0]
        for d in diferencias:
            bbox = d.get("bbox")
            if not bbox:
                continue
            rect = fitz.Rect(*bbox)
            if d["tipo"] == "cambiat":
                page.draw_rect(rect, color=(1, 0, 0), width=1.5)
                page.insert_text((rect.x0, max(rect.y0 - 6, 0)), f"Era: {d['valor_anterior']}", color=(1, 0, 0), fontsize=7)
            elif d["tipo"] == "nou":
                page.draw_rect(rect, color=(0, 0.6, 0), width=1.5)
            elif d["tipo"] == "eliminat":
                page.draw_rect(rect, color=(1, 0.5, 0), width=1.0, dashes="[2] 0")
                page.insert_text((rect.x0, max(rect.y0 - 6, 0)), f"Eliminat: {d['valor_anterior']}", color=(1, 0.5, 0), fontsize=7)

        if hay_diff_3d and zona_3d:
            # zona_3d está en píxeles de la imagen renderizada a
            # ZOOM_RENDER_COMPARADOR — se reescala a puntos PDF dividiendo
            # por el mismo factor.
            esc = 1.0 / ZOOM_RENDER_COMPARADOR
            rect3d = fitz.Rect(zona_3d[0] * esc, zona_3d[1] * esc, zona_3d[2] * esc, zona_3d[3] * esc)
            shape = page.new_shape()
            shape.draw_rect(rect3d)
            shape.finish(color=(1, 0, 0), fill=(1, 0, 0), fill_opacity=0.25, width=0)
            shape.commit()

        os.makedirs(os.path.dirname(ruta_salida), exist_ok=True)
        doc.save(ruta_salida)
    finally:
        doc.close()


def comparar_planols(pdf_original_path: str, pdf_nuevo_path: str, codigo_pieza: str, ruta_salida: str) -> Optional[dict]:
    """Compara dos revisiones de un plànol (cotas numéricas + vista 3D) y
    genera el PDF de diferencias en ruta_salida. Devuelve
    {tiene_diferencias, num_diferencias, diferencias, pdf_resultado} o
    None si algo impide comparar — nunca lanza, para no tumbar el flujo
    de descarga que la llama."""
    if not os.path.isfile(pdf_original_path) or not os.path.isfile(pdf_nuevo_path):
        return None
    try:
        log_sse("COMPARE", f"Iniciant comparació de plànols de {codigo_pieza}...")

        log_sse("COMPARE", "Extraient cotes numèriques del plànol original...")
        tokens_orig = _extraer_tokens_cota(pdf_original_path)
        log_sse("COMPARE", f"Plànol original: {len(tokens_orig)} tokens de cota trobats")

        log_sse("COMPARE", "Extraient cotes numèriques del plànol nou...")
        tokens_nuevo = _extraer_tokens_cota(pdf_nuevo_path)
        log_sse("COMPARE", f"Plànol nou: {len(tokens_nuevo)} tokens de cota trobats")

        diagonal = _diagonal_pagina(pdf_nuevo_path)
        log_sse("COMPARE", f"Comparant per posició (radi = 5% de la diagonal ≈ {diagonal * RADIO_COMPARACION_PCT:.0f}pt)...")
        diferencias = _comparar_cotas(tokens_orig, tokens_nuevo, diagonal)
        log_sse("COMPARE", f"{len(diferencias)} diferència(es) de cota trobades")

        log_sse("COMPARE", "Detectant zona 3D/isomètrica...")
        img_orig = _render_pagina_gris(pdf_original_path)
        img_nuevo = _render_pagina_gris(pdf_nuevo_path)
        zona_3d = _detectar_zona_3d(img_nuevo)
        x0, y0, x1, y1 = zona_3d
        log_sse("COMPARE", f"Zona 3D detectada: x={x0} y={y0} w={x1 - x0} h={y1 - y0}")

        hay_diff_3d = False
        try:
            log_sse("COMPARE", "Comparant zona 3D píxel a píxel...")
            proporcion_3d = _comparar_zona_3d(img_orig, img_nuevo, zona_3d)
            hay_diff_3d = proporcion_3d > UMBRAL_DIFERENCIA_3D
            log_sse("COMPARE", f"Zona 3D: {proporcion_3d * 100:.1f}% de píxels canviats" + (" — canvi detectat" if hay_diff_3d else ""))
        except Exception as e:
            log.warning(f"[Comparar] No se pudo comparar la zona 3D de {codigo_pieza}: {e}")
            log_sse("ERROR", f"No s'ha pogut comparar la zona 3D: {e}")

        if hay_diff_3d:
            diferencias.append({"tipo": "vista_3d", "descripcio": "Canvis detectats a la vista 3D/isomètrica"})

        log_sse("COMPARE", "Generant PDF amb diferències marcades...")
        _generar_pdf_diferencias(pdf_nuevo_path, diferencias, zona_3d, hay_diff_3d, ruta_salida)
        log_sse("FILE", f"PDF de diferències guardat: {os.path.basename(ruta_salida)}")

        return {
            "tiene_diferencias": len(diferencias) > 0,
            "num_diferencias": len(diferencias),
            "diferencias": diferencias,
            "pdf_resultado": ruta_salida,
        }
    except Exception as e:
        log.error(f"[Comparar] Error comparando plànols de {codigo_pieza}: {e}")
        log_sse("ERROR", f"Error comparant plànols de {codigo_pieza}: {e}")
        log_sse("INFO", f"Stack trace: {traceback.format_exc()}")
        return None


def _validar_ruta_absoluta_comparador(ruta: str) -> Optional[str]:
    """Para /comparar-planols: la ruta debe caer dentro de las carpetas que
    el propio servidor ya gestiona (plànols de fabricació o comercial) —
    mismo espíritu que _validar_ruta_config, pero aquí no hay fallback a un
    default porque la ruta ES el dato: si no es válida, se rechaza sin más
    (este endpoint queda expuesto sin autenticación a toda la LAN, igual
    que el resto — ver nota de SERVIDOR_UNC_PERMITIDO)."""
    if not ruta:
        return None
    ruta_norm = os.path.normpath(ruta)
    for raiz in (CARPETA_RAIZ_1076, CARPETA_TEMPORAL, CARPETA_COMERCIAL):
        raiz_norm = os.path.normpath(raiz)
        try:
            if os.path.commonpath([ruta_norm, raiz_norm]) == raiz_norm:
                return ruta_norm
        except ValueError:
            continue  # unidades distintas (p.ej. una ruta relativa colada) -> no válida
    return None


class ComparacionRequest(BaseModel):
    pdf_original_path: str
    pdf_nuevo_path: str
    codigo_pieza: str
    comanda: str = ""


@app.post("/comparar-planols")
def comparar_planols_endpoint(req: ComparacionRequest):
    """Compara dos PDFs de plànols y genera el PDF de diferencias en la
    carpeta comercial de la comanda indicada. Lo llama internamente el
    flujo de descarga (_hacer_descarga) directamente como función Python,
    sin pasar por HTTP — este endpoint existe para poder disparar una
    comparación puntual desde fuera (pruebas, uso manual)."""
    origen = _validar_ruta_absoluta_comparador(req.pdf_original_path)
    nuevo = _validar_ruta_absoluta_comparador(req.pdf_nuevo_path)
    if not origen or not nuevo:
        raise HTTPException(400, "Ruta de PDF no permitida")
    if not os.path.isfile(origen):
        raise HTTPException(404, f"No se encuentra el PDF original: {req.pdf_original_path}")
    if not os.path.isfile(nuevo):
        raise HTTPException(404, f"No se encuentra el PDF nuevo: {req.pdf_nuevo_path}")

    carpeta_comanda = os.path.join(CARPETA_COMERCIAL, req.comanda) if req.comanda else CARPETA_COMERCIAL
    os.makedirs(carpeta_comanda, exist_ok=True)
    ruta_salida = os.path.join(carpeta_comanda, f"{req.codigo_pieza}_DIFERENCIES.pdf")

    resultado = comparar_planols(origen, nuevo, req.codigo_pieza, ruta_salida)
    if resultado is None:
        raise HTTPException(500, "No se pudo comparar los plànols (ver servidor.log)")
    return resultado


# =====================================================================
# PREVISUALIZACIÓN DE GEO — el frontend parsea el .geo (texto) y dibuja
# un SVG simplificado del contorno de la pieza en el buscador de piezas.
# =====================================================================

@app.get("/geo/{codigo_pdm}")
def obtener_geo(codigo_pdm: str, ruta: str = ""):
    """Busca en la carpeta de plànols de fabricació (config del usuario, o
    CARPETA_RAIZ_1076 por defecto) el .geo de la pieza (nombre
    "{codigo_pdm}_vN....geo", case-insensitive), se queda con la
    versión N más alta y devuelve su contenido en crudo como texto para
    que el frontend lo parsee. Los .geo ya anulados (--ANUL·LAT--) no
    cuentan como versión activa. Si no hay ninguno, {"encontrado": False}
    en vez de un 404 — es un caso normal (la mayoría de piezas todavía no
    tienen geo), no un error."""
    carpeta = _validar_ruta_config(ruta, "ruta_planols_fabricacio", CARPETA_RAIZ_1076)
    codigo_pdm = codigo_pdm.strip()
    if not codigo_pdm or not os.path.isdir(carpeta):
        return {"encontrado": False}

    prefijo = (codigo_pdm + "_v").lower()
    candidatos = []  # (version, nombre_real)
    for f in _listar_con_cache(carpeta):
        nombre_lower = f.lower()
        if nombre_lower.startswith(ANUL_PREFIX.lower()):
            continue  # geo ya anulado -> no es la versión activa
        if not nombre_lower.startswith(prefijo) or not nombre_lower.endswith(".geo"):
            continue
        resto = nombre_lower[len(prefijo):]  # p.ej. "1.geo" o "1_in3.geo"
        m = re.match(r"^(\d+)", resto)
        if not m:
            continue
        candidatos.append((int(m.group(1)), f))

    if not candidatos:
        return {"encontrado": False}

    candidatos.sort(key=lambda x: x[0])
    _version, nombre = candidatos[-1]
    ruta = os.path.join(carpeta, nombre)
    if not os.path.isfile(ruta):
        return {"encontrado": False}

    try:
        # Los .geo de TRUMPF son texto en la codepage de Windows indicada
        # dentro del propio archivo (ANSI_CODEPAGE@1252) — no UTF-8.
        with open(ruta, "r", encoding="cp1252", errors="replace") as fh:
            contenido = fh.read()
    except Exception as e:
        log.error(f"[Geo] Error leyendo {ruta}: {e}")
        return {"encontrado": False}

    return {"encontrado": True, "contenido": contenido, "archivo": nombre}


@app.on_event("startup")
async def startup():
    global _main_loop
    _main_loop = asyncio.get_running_loop()
    log.info("[Servidor] Orquestador 1076 listo.")
    asyncio.create_task(_polling_inbox_txt())

    global _INDICE_PIEZAS
    _INDICE_PIEZAS = _cargar_indice_cache()
    log.info(f"[Indice] Cargado desde caché: {len(_INDICE_PIEZAS)} piezas")
    asyncio.create_task(_reindexar_async())  # refresca en segundo plano sin bloquear el arranque
    asyncio.create_task(_reindexar_periodico())  # i despres, cada 10 min