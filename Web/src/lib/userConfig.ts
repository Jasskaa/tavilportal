/**
 * Config personal de rutas de cada usuario — se guarda en localStorage del
 * navegador (clave "user_config") y se envía junto a cada petición que
 * necesite rutas (excels, plànols, comercial). El servidor SIEMPRE valida
 * lo que le llega (solo acepta UNC bajo \\SRVDADES\...) y cae a sus rutas
 * por defecto si no viene nada o no es válido — ver _validar_ruta_config
 * en main.py. La ruta de "Arxius STEP" (abrir SolidWorks) NO es
 * configurable a propósito: ese endpoint ejecuta os.startfile() en el
 * propio servidor (que corre como servicio LocalSystem, sin autenticación,
 * en toda la LAN), así que aceptar ahí una ruta de cliente sería una
 * puerta a ejecución de código arbitraria en el servidor.
 */

export interface UserConfig {
  rutaPlanolsFabricacio: string;
  rutaPlanolsTaller: string;
  rutaExcels: string;
  rutaComercial: string;
  // "Quan es processa una comanda" (imprimir/descarregar) i "detectar
  // correus en segon pla" ja NO viuen aquí -- són configuració del
  // SERVIDOR (veure getAccioDocuments/getDeteccioCorreu a api.ts), perquè
  // el correu real d'Outlook truca directament al servidor sense passar
  // mai per cap navegador, i localStorage és només per-navegador.
  /** "Entorn de proves" (simular correu sense esperar-ne un de real) és una
   * eina de suport/depuració — amagada per defecte perquè no molesti al dia
   * a dia; s'activa des d'Ajustos > Avançat quan cal fer una prova. */
  mostrarEntornProves: boolean;
}

/** Config buida — cap override, el servidor fa servir sempre les seves
 * rutes per defecte. És l'estat inicial (SSR-safe, sense tocar
 * localStorage) i el que deixa "Restaurar per defecte". */
export const USER_CONFIG_BUIDA: UserConfig = {
  rutaPlanolsFabricacio: "",
  rutaPlanolsTaller: "",
  rutaExcels: "",
  rutaComercial: "",
  mostrarEntornProves: false,
};

/** Rutes reals per defecte del servidor — NOMÉS per mostrar-les com a
 * placeholder al formulari d'Ajustos. Mai s'envien tal quals: si l'usuari
 * no escriu res, no s'envia cap paràmetre i el servidor ja fa servir
 * aquests mateixos valors. Han d'estar sincronitzades amb main.py:
 * CARPETA_RAIZ_1076 / CARPETA_TALLER / CARPETA_EXCELS / CARPETA_COMERCIAL. */
export const RUTES_PER_DEFECTE: Omit<UserConfig, "mostrarEntornProves"> = {
  rutaPlanolsFabricacio: String.raw`\\SRVDADES\dades domoli\Fabricacio\PLANOLS\1076`,
  rutaPlanolsTaller: String.raw`\\SRVDADES\taller\planols taller\1076`,
  rutaExcels: String.raw`\\SRVDADES\dades domoli\Costos\COSTOS\1076 -- TAVIL`,
  rutaComercial: String.raw`\\SRVDADES\dades domoli\Comercial\Tavil`,
};

const STORAGE_KEY = "user_config";
const EVENT_CANVI = "user-config-changed";

export function obtenirUserConfig(): UserConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...USER_CONFIG_BUIDA };
    const parsed = JSON.parse(raw);
    return { ...USER_CONFIG_BUIDA, ...parsed };
  } catch {
    return { ...USER_CONFIG_BUIDA };
  }
}

/** Desa la config i avisa la resta de components muntats (p.ex. la pàgina
 * de Descàrrega) que hi ha una config nova — sense això, un canvi fet des
 * d'Ajustos (com activar "Entorn de proves") no es veuria fins a recarregar
 * la pàgina, ja que cada component llegeix localStorage només en muntar-se. */
export function guardarUserConfig(config: UserConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* silencio */
  }
  window.dispatchEvent(new CustomEvent<UserConfig>(EVENT_CANVI, { detail: config }));
}

export function subscriureCanvisUserConfig(callback: (config: UserConfig) => void): () => void {
  const handler = (e: Event) => callback((e as CustomEvent<UserConfig>).detail);
  window.addEventListener(EVENT_CANVI, handler);
  return () => window.removeEventListener(EVENT_CANVI, handler);
}
