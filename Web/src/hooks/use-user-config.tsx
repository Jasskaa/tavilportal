import * as React from "react";
import {
  obtenirUserConfig,
  guardarUserConfig,
  subscriureCanvisUserConfig,
  USER_CONFIG_BUIDA,
  type UserConfig,
} from "@/lib/userConfig";

/**
 * Config personal del usuario (rutas de red), guardada en localStorage.
 * Se usa en todos los componentes que llaman a funciones de api.ts que
 * necesitan rutas — cada uno envía su copia junto a la petición.
 *
 * SSR-safe: el estado inicial es la config "buida" (sin tocar localStorage
 * durante el render, que podría ejecutarse en el servidor) y la config
 * real guardada se carga en un useEffect tras montar, mismo patrón que
 * useTema (ver src/lib/tema.ts).
 */
export function useUserConfig() {
  const [config, setConfigState] = React.useState<UserConfig>(USER_CONFIG_BUIDA);

  React.useEffect(() => {
    setConfigState(obtenirUserConfig());
    return subscriureCanvisUserConfig(setConfigState);
  }, []);

  const guardar = React.useCallback((nou: UserConfig) => {
    guardarUserConfig(nou);
    setConfigState(nou);
  }, []);

  const restaurar = React.useCallback(() => {
    guardarUserConfig(USER_CONFIG_BUIDA);
    setConfigState(USER_CONFIG_BUIDA);
    return USER_CONFIG_BUIDA;
  }, []);

  return { config, guardar, restaurar };
}
