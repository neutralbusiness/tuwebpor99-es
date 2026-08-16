export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Redirect apex -> www
    if (url.hostname === "tuwebpor99.es") {
      url.hostname = "www.tuwebpor99.es";
      return Response.redirect(url.toString(), 301);
    }

    // El indice real de esta web es /sitemap_index.xml. /sitemap.xml no existe, y
    // devolver 404 rompe herramientas y enlaces que asumen la ruta clasica.
    if (url.pathname === "/sitemap.xml") {
      const destino = new URL(url);
      destino.pathname = "/sitemap_index.xml";
      return Response.redirect(destino.toString(), 301);
    }

    return env.ASSETS.fetch(request);
  },
};
