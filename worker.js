export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Redirect apex -> www
    if (url.hostname === "tuwebpor99.es") {
      url.hostname = "www.tuwebpor99.es";
      return Response.redirect(url.toString(), 301);
    }

    // El embudo de contratación habla con el panel a través de aquí. El
    // navegador del cliente nunca ve el panel ni su secreto: pide a su propio
    // dominio y el Worker reenvía firmando la llamada.
    if (url.pathname.startsWith("/api/solicitud")) {
      return contratacion(request, env, url);
    }

    const __r = await env.ASSETS.fetch(request);
    if (url.pathname.endsWith(".txt") && __r.headers.get("content-type") === "text/plain") {
      const __h = new Headers(__r.headers);
      __h.set("content-type", "text/plain; charset=utf-8");
      return new Response(__r.body, { status: __r.status, statusText: __r.statusText, headers: __h });
    }
    return __r;
  },
};

const PANEL = "https://panel.neutralb.es/api/public/contratacion";

/** Rutas admitidas. Todo lo demás se rechaza sin llegar al panel. */
const RUTAS = [
  { metodo: "POST", re: /^\/api\/solicitud$/, destino: () => "" },
  { metodo: "GET", re: /^\/api\/solicitud\/([0-9a-f-]{36})$/, destino: (m) => `/${m[1]}` },
  { metodo: "PATCH", re: /^\/api\/solicitud\/([0-9a-f-]{36})$/, destino: (m) => `/${m[1]}` },
  { metodo: "GET", re: /^\/api\/solicitud\/([0-9a-f-]{36})\/contrato$/, destino: (m) => `/${m[1]}/contrato` },
  { metodo: "POST", re: /^\/api\/solicitud\/([0-9a-f-]{36})\/contrato$/, destino: (m) => `/${m[1]}/contrato` },
  { metodo: "POST", re: /^\/api\/solicitud\/([0-9a-f-]{36})\/pago$/, destino: (m) => `/${m[1]}/pago` },
];

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function contratacion(request, env, url) {
  if (!env.WORKER_SECRET) {
    return json({ error: "Contratación no configurada: falta WORKER_SECRET en el Worker." }, 503);
  }

  let destino = null;
  for (const r of RUTAS) {
    if (r.metodo !== request.method) continue;
    const m = url.pathname.match(r.re);
    if (m) { destino = r.destino(m); break; }
  }
  if (destino === null) return json({ error: "Ruta no válida" }, 404);

  const cabeceras = new Headers({
    "content-type": "application/json",
    "x-worker-secret": env.WORKER_SECRET,
    // La IP del cliente final hace falta para la prueba de aceptación del
    // contrato: la del panel sería la de Cloudflare.
    "x-cliente-ip": request.headers.get("cf-connecting-ip") || "",
    "user-agent": request.headers.get("user-agent") || "",
  });

  const cuerpo = request.method === "GET" ? undefined : await request.text();
  if (cuerpo && cuerpo.length > 250000) return json({ error: "Demasiados datos" }, 413);

  try {
    const res = await fetch(`${PANEL}${destino}`, {
      method: request.method,
      headers: cabeceras,
      body: cuerpo,
    });
    const texto = await res.text();
    return new Response(texto, {
      status: res.status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (e) {
    return json({ error: "No hemos podido guardar ahora mismo. Inténtalo en un momento." }, 502);
  }
}
