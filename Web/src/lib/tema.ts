/**
 * Tema clar/fosc de toda la app — una sola clase "dark" en <html>
 * (ver styles.css: :root = clar, .dark = fosc) más localStorage para
 * recordarlo entre sesiones. El fosc es el aspecto histórico de la app,
 * así que es el valor por defecto si el usuario nunca ha elegido nada.
 */

export type Tema = "fosc" | "clar";

const CLAU_TEMA = "orquestador:tema";

export function obtenirTemaGuardat(): Tema {
  try {
    return localStorage.getItem(CLAU_TEMA) === "clar" ? "clar" : "fosc";
  } catch {
    return "fosc";
  }
}

/** Aplica el tema al <html> (clase "dark") y lo guarda en localStorage. */
export function aplicarTema(tema: Tema): void {
  document.documentElement.classList.toggle("dark", tema === "fosc");
  try {
    localStorage.setItem(CLAU_TEMA, tema);
  } catch {
    /* silencio */
  }
}
