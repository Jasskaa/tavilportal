import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Copia text al porta-retalls funcionant tant per HTTPS/localhost com per
 * HTTP pla — aquest portal sempre es fa servir per HTTP normal dins la
 * xarxa local (http://192.168.x.x:3000), on `navigator.clipboard` NO
 * existeix (l'API només és vàlida en contextos segurs). Per això cal
 * aquest fallback amb un <textarea> ocult + document.execCommand("copy"),
 * que sí funciona sobre HTTP normal.
 */
export async function copiarAlPortaretes(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* cau al fallback de sota */
    }
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
