/**
 * Tema clar/fosc de toda la app — una sola clase "dark" en <html>
 * (ver styles.css: :root = clar, .dark = fosc) más localStorage para
 * recordarlo entre sesiones. El clar (dashboard estil Dribbble) es
 * l'aspecte per defecte; el fosc queda disponible des d'Ajustos per a qui
 * el prefereixi.
 */

export type Tema = "fosc" | "clar";

const CLAU_TEMA = "orquestador:tema";

export function obtenirTemaGuardat(): Tema {
  try {
    return localStorage.getItem(CLAU_TEMA) === "fosc" ? "fosc" : "clar";
  } catch {
    return "clar";
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
