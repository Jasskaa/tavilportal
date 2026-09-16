import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Portal, type Seccion } from "@/components/orquestador/Portal";

const title = "Orquestador 1076 · Tavil";
const description =
  "Buscador de piezas de chapa metálica y descarga de comandas: plànols de cliente y taller, Excels de costos y proceso automático por correo.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
    ],
  }),
  component: Index,
});

interface EstadoGuardado {
  seccion: Seccion;
}

const STORAGE_KEY = "orquestador:seccion";

function Index() {
  // El render inicial (servidor y primer render del cliente) siempre usa
  // el valor por defecto — leer localStorage aquí directamente provoca un
  // desajuste de hidratación, porque el servidor no tiene localStorage.
  // Lo guardado se aplica en el useEffect de abajo, que solo corre en el
  // cliente después de montar.
  const [seccion, setSeccion] = useState<Seccion>("buscador");
  const [hidratado, setHidratado] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const guardado: Partial<EstadoGuardado> = raw ? JSON.parse(raw) : {};
      if (guardado.seccion) setSeccion(guardado.seccion);
    } catch {
      /* silencio */
    } finally {
      setHidratado(true);
    }
  }, []);

  useEffect(() => {
    if (!hidratado) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ seccion }));
    } catch {
      /* silencio */
    }
  }, [seccion, hidratado]);

  return <Portal seccionInicial={seccion} onSeccionChange={setSeccion} />;
}
