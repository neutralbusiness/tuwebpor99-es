export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Redirect apex -> www
    if (url.hostname === "tuwebpor99.es") {
      url.hostname = "www.tuwebpor99.es";
      return Response.redirect(url.toString(), 301);
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
