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
  /** Què fer amb els documents quan es processa una comanda pel flux
   * automàtic (correu) — o des de "Entorn de proves": imprimir-los amb
   * la impressora del servidor, o deixar-los preparats com a ZIP perquè
   * el navegador els descarregui. No afecta la descàrrega manual, que ja
   * té els seus propis botons "Imprimir tot"/"Descarregar tot" per targeta. */
  accioDocuments: "imprimir" | "descarregar";
}

/** Config buida — cap override, el servidor fa servir sempre les seves
 * rutes per defecte. És l'estat inicial (SSR-safe, sense tocar
 * localStorage) i el que deixa "Restaurar per defecte". */
export const USER_CONFIG_BUIDA: UserConfig = {
  rutaPlanolsFabricacio: "",
  rutaPlanolsTaller: "",
  rutaExcels: "",
  rutaComercial: "",
  accioDocuments: "imprimir",
};

/** Rutes reals per defecte del servidor — NOMÉS per mostrar-les com a
 * placeholder al formulari d'Ajustos. Mai s'envien tal quals: si l'usuari
 * no escriu res, no s'envia cap paràmetre i el servidor ja fa servir
 * aquests mateixos valors. Han d'estar sincronitzades amb main.py:
 * CARPETA_RAIZ_1076 / CARPETA_TALLER / CARPETA_EXCELS / CARPETA_COMERCIAL. */
export const RUTES_PER_DEFECTE: Omit<UserConfig, "accioDocuments"> = {
  rutaPlanolsFabricacio: String.raw`\\SRVDADES\dades domoli\Fabricacio\PLANOLS\1076`,
  rutaPlanolsTaller: String.raw`\\SRVDADES\taller\planols taller\1076`,
  rutaExcels: String.raw`\\SRVDADES\dades domoli\Costos\COSTOS\1076 -- TAVIL`,
  rutaComercial: String.raw`\\SRVDADES\dades domoli\Comercial\Tavil`,
};

const STORAGE_KEY = "user_config";

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

export function guardarUserConfig(config: UserConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* silencio */
  }
}
