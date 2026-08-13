export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Redirect apex -> www
    if (url.hostname === "tuwebpor99.es") {
      url.hostname = "www.tuwebpor99.es";
      return Response.redirect(url.toString(), 301);
    }

    return env.ASSETS.fetch(request);
  },
};
