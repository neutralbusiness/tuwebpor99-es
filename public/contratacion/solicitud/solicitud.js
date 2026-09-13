/**
 * Embudo de contratación de tuwebpor99.es.
 *
 * El formulario guarda solo en el servidor: cada cambio va a /api/solicitud,
 * que el Worker reenvía al panel. No usamos localStorage como almacén porque
 * el cliente tiene que poder retomar desde otro dispositivo con su enlace, y
 * dos copias del mismo formulario acabarían discrepando.
 *
 * El token vive en la URL (?t=...). Es la credencial: quien lo tiene, ve y
 * edita esa solicitud. Por eso la página va con noindex y el enlace se manda
 * solo al correo que el cliente ha escrito.
 */
(function () {
  "use strict";

  var API = "/api/solicitud";
  var CFG = window.SOL_CFG || {};
  var IDIOMA = CFG.locale === "en" ? "en" : "es";
  var T = CFG.textos || {};
  var estado = null;      // lo que devuelve el servidor
  var token = null;
  var pasoActual = 1;
  var pendiente = null;   // temporizador del autoguardado
  var guardando = false;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // ── Utilidades de datos ────────────────────────────────────────────────
  function leerRuta(obj, ruta) {
    return ruta.split(".").reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj);
  }
  function escribirRuta(obj, ruta, valor) {
    var partes = ruta.split(".");
    var ult = partes.pop();
    var cur = obj;
    partes.forEach(function (k) { if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {}; cur = cur[k]; });
    cur[ult] = valor;
  }

  /** Recoge del DOM todo lo que el cliente ha escrito, agrupado por sección. */
  function recogerBrief() {
    var brief = {};
    $$("[data-k]").forEach(function (el) {
      var k = el.getAttribute("data-k");
      if (el.type === "radio") {
        if (el.checked) escribirRuta(brief, k, el.value);
      } else if (el.type === "checkbox") {
        var actual = leerRuta(brief, k);
        if (!Array.isArray(actual)) { actual = []; escribirRuta(brief, k, actual); }
        if (el.checked) actual.push(el.value);
      } else {
        escribirRuta(brief, k, el.value.trim());
      }
    });
    return brief;
  }

  /** Vuelca en el DOM lo que ya estaba guardado. */
  function pintarBrief(brief) {
    if (!brief) return;
    $$("[data-k]").forEach(function (el) {
      var v = leerRuta(brief, el.getAttribute("data-k"));
      if (el.type === "radio") {
        if (v != null) el.checked = el.value === v;
      } else if (el.type === "checkbox") {
        if (Array.isArray(v)) el.checked = v.indexOf(el.value) !== -1;
      } else if (v != null && v !== "") {
        el.value = v;
      }
    });
  }

  // ── Llamadas al servidor ───────────────────────────────────────────────
  function api(ruta, opciones) {
    return fetch(API + ruta, Object.assign({ headers: { "content-type": "application/json" } }, opciones || {}))
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) throw new Error(j.error || T.errorRed);
          return j;
        });
      });
  }

  function marcaGuardado(texto, ok) {
    $$(".guardado").forEach(function (n) {
      n.textContent = texto;
      n.className = "guardado" + (ok ? " ok" : "");
    });
  }

  function guardar(paso) {
    if (!token || guardando) return Promise.resolve();
    guardando = true;
    marcaGuardado(T.guardando, false);
    return api("/" + token, {
      method: "PATCH",
      body: JSON.stringify({ brief: recogerBrief(), step: paso || pasoActual }),
    })
      .then(function (j) { estado = j; marcaGuardado(T.guardado, true); })
      .catch(function (e) { marcaGuardado(e.message, false); })
      .then(function () { guardando = false; });
  }

  function autoguardar() {
    clearTimeout(pendiente);
    marcaGuardado(T.sinGuardar, false);
    pendiente = setTimeout(function () { guardar(); }, 900);
  }

  // ── Validación ─────────────────────────────────────────────────────────
  function visible(el) {
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  function validaPaso(n) {
    var seccion = $('.sol-paso[data-paso="' + n + '"]');
    var malos = [];
    $$("[required]", seccion).forEach(function (el) {
      var campo = el.closest(".campo");
      if (!campo || !visible(campo)) return;
      var v = (el.value || "").trim();
      var bien = !!v;
      if (bien && el.type === "email") bien = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v);
      campo.classList.toggle("mal", !bien);
      if (!bien) malos.push(campo);
    });
    if (malos.length) {
      malos[0].scrollIntoView({ behavior: "smooth", block: "center" });
      var primer = $("input,select,textarea", malos[0]);
      if (primer) primer.focus({ preventScroll: true });
      aviso(T.camposMal, "malo");
      return false;
    }
    ocultaAviso();
    return true;
  }

  // ── Navegación ─────────────────────────────────────────────────────────
  function irA(n, sinValidar) {
    if (n > pasoActual && !sinValidar && !validaPaso(pasoActual)) return;
    pasoActual = n;
    $$(".sol-paso").forEach(function (s) { s.classList.toggle("on", Number(s.dataset.paso) === n); });
    $$("#sol-pasos li").forEach(function (li) {
      var p = Number(li.dataset.p);
      li.classList.toggle("on", p === n);
      li.classList.toggle("ok", p < n);
    });
    $("#retomar").classList.toggle("oculto", n >= 6);
    $("#sol-pasos").classList.toggle("oculto", n >= 6);
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (n === 4) cargaContrato();
    if (n === 5) pintaResumen();
    if (!sinValidar) guardar(n);
  }

  function aviso(texto, tipo) {
    var a = $("#aviso");
    a.textContent = texto;
    a.className = "aviso ver " + (tipo || "malo");
  }
  function ocultaAviso() { $("#aviso").className = "aviso malo"; }

  // ── Producto y dependencias del formulario ─────────────────────────────
  var PRODUCTOS = CFG.productos;

  function euros(cents) {
    return (cents / 100).toLocaleString(IDIOMA === "en" ? "en-IE" : "es-ES", { style: "currency", currency: "EUR" });
  }

  function pintaProducto() {
    var cont = $("#producto-ops");
    cont.innerHTML = "";
    Object.keys(PRODUCTOS).forEach(function (id) {
      var p = PRODUCTOS[id];
      var marcado = estado.product === id;
      var l = document.createElement("label");
      l.className = "opcion";
      l.innerHTML =
        '<input type="radio" name="prod" value="' + id + '"' + (marcado ? " checked" : "") +
        '><span><b>' + p.titulo + " — " + euros(p.precio) + T.masIvaCorto + "</b><small>" + p.nota + "</small></span>";
      cont.appendChild(l);
    });
    // Cambiar de producto obliga a empezar una solicitud nueva: el precio y
    // las condiciones aceptadas van atados al producto.
    $$('input[name="prod"]', cont).forEach(function (r) {
      r.addEventListener("change", function () {
        if (r.value === estado.product) return;
        if (!confirm(T.cambioProducto)) {
          $$('input[name="prod"]', cont).forEach(function (o) { o.checked = o.value === estado.product; });
          return;
        }
        location.href = "?p=" + r.value;
      });
    });
    $$(".tienda").forEach(function (n) { n.classList.toggle("oculto", estado.product !== "shop"); });
  }

  function aplicaDependencias() {
    var tipo = ($('input[name="fact"]:checked') || {}).value || "particular";
    $$(".fact-empresa").forEach(function (n) { n.classList.toggle("oculto", tipo !== "empresa"); });
    $$(".fact-autonomo").forEach(function (n) { n.classList.toggle("oculto", tipo === "particular"); });
    // El NIF fiscal solo es obligatorio cuando factura una empresa o un
    // autónomo; el particular ya ha dado su DNI arriba.
    var nif = $("#fa-nif");
    if (nif) nif.required = tipo !== "particular";
    var razon = $("#fa-razon");
    if (razon) razon.required = tipo === "empresa";

    var wa = ($('input[name="wa"]:checked') || {}).value || "mismo";
    $("#p-wa").closest(".campo").classList.toggle("oculto", wa !== "otro");

    var mat = ($('input[name="mat"]:checked') || {}).value || "whatsapp";
    $("#x-enlace").closest(".campo").classList.toggle("oculto", mat !== "enlace");

    var dom = ($('input[name="dom"]:checked') || {}).value || "nuevo";
    var etiqueta = $('label[for="f-dominio"]');
    if (etiqueta) etiqueta.textContent = dom === "tengo" ? T.dominioTengo : T.dominioQuiero;
  }

  // ── Contrato ───────────────────────────────────────────────────────────
  var contratoCargado = false;
  function cargaContrato() {
    if (contratoCargado) return;
    // Se pide después de guardar, para que salga con los datos reales de la
    // parte que contrata y no con los de hace tres pasos.
    guardar(4).then(function () {
      return api("/" + token + "/contrato");
    }).then(function (c) {
      var html = c.sections.map(function (s) {
        return "<h3>" + s.title + "</h3>" + s.body.map(function (p) { return "<p>" + p + "</p>"; }).join("");
      }).join("");
      $("#contrato").innerHTML = html;
      contratoCargado = true;
    }).catch(function (e) {
      $("#contrato").textContent = T.contratoError + " " + e.message;
    });
  }

  // ── Resumen del pago ───────────────────────────────────────────────────
  function pintaResumen() {
    var iva = estado.vatPct || 21;
    var base = estado.basePriceCents;
    var cuota = Math.round(base * iva / 100);
    var anual = estado.annualPriceCents;
    var filas = [
      [PRODUCTOS[estado.product].titulo, euros(base)],
      [T.iva.replace("{pct}", String(iva)), euros(cuota)],
      [T.primerAno, T.incluido],
      [T.segundoAno, euros(anual) + T.masIva],
      [T.totalHoy, euros(base + cuota)],
    ];
    $("#resumen").innerHTML = filas.map(function (f) {
      return "<div><span>" + f[0] + "</span><b>" + f[1] + "</b></div>";
    }).join("");
  }

  // ── Arranque ───────────────────────────────────────────────────────────
  function arranca(j) {
    estado = j;
    token = j.token;
    var url = new URL(location.href);
    url.searchParams.set("t", token);
    url.searchParams.delete("p");
    history.replaceState(null, "", url.pathname + "?" + url.searchParams.toString());

    $("#enlace").value = location.origin + location.pathname + "?t=" + token;
    pintarBrief(j.brief);
    pintaProducto();
    aplicaDependencias();

    $("#cargando").classList.add("oculto");
    $("#app").classList.remove("oculto");

    var pago = new URL(location.href).searchParams.get("pago");
    if (j.status === "paid" || j.status === "in_production" || j.status === "delivered") {
      irA(6, true);
      return;
    }
    if (pago === "ko") {
      aviso(T.pagoKo, "malo");
      irA(5, true);
      return;
    }
    if (pago === "ok") {
      // Stripe nos devuelve antes de que llegue su webhook: mostramos el paso
      // de pago con un aviso en vez de dar por cobrado lo que aún no consta.
      aviso(T.pagoConfirmando, "bueno");
      irA(5, true);
      return;
    }
    irA(Math.min(Math.max(j.step || 1, 1), j.contractAcceptedAt ? 5 : 4), true);
  }

  function inicia() {
    var params = new URL(location.href).searchParams;
    var t = params.get("t");
    var p = params.get("p");

    if (t) {
      api("/" + t).then(arranca).catch(function (e) {
        $("#cargando").innerHTML = T.noEncontrada +
          '<br><br><a class="btn btn-primary" href="../">' + T.empezarDeNuevo + "</a>";
      });
      return;
    }
    if (p !== "web" && p !== "shop") p = "web";
    api("", { method: "POST", body: JSON.stringify({ product: p, locale: "es" }) })
      .then(arranca)
      .catch(function (e) {
        $("#cargando").innerHTML = T.noAbrir + " " + e.message +
          '<br><br><a class="btn btn-primary" href="../">' + T.volver + "</a>";
      });
  }

  // ── Eventos ────────────────────────────────────────────────────────────
  document.addEventListener("input", function (e) {
    if (e.target.matches("[data-k]")) autoguardar();
  });
  document.addEventListener("change", function (e) {
    if (e.target.matches("[data-k]")) { aplicaDependencias(); autoguardar(); }
  });
  document.addEventListener("click", function (e) {
    var sig = e.target.closest("[data-siguiente]");
    if (sig) { irA(Number(sig.dataset.siguiente)); return; }
    var ant = e.target.closest("[data-anterior]");
    if (ant) { irA(Number(ant.dataset.anterior), true); return; }
  });

  $("#btn-copiar").addEventListener("click", function () {
    var i = $("#enlace");
    i.select();
    navigator.clipboard.writeText(i.value).then(function () {
      $("#btn-copiar").textContent = T.copiado;
      setTimeout(function () { $("#btn-copiar").textContent = T.copiar; }, 2000);
    }).catch(function () { document.execCommand("copy"); });
  });

  $("#btn-aceptar").addEventListener("click", function () {
    var cond = $("#ac-cond").checked, datos = $("#ac-datos").checked, cargo = $("#ac-cargo").checked;
    if (!cond || !datos || !cargo) {
      aviso(T.faltanCasillas, "malo");
      return;
    }
    var btn = this;
    btn.disabled = true;
    btn.textContent = T.registrando;
    guardar(4)
      .then(function () {
        return api("/" + token + "/contrato", {
          method: "POST",
          body: JSON.stringify({ aceptaCondiciones: true, aceptaDatos: true, aceptaCargoAnual: true }),
        });
      })
      .then(function (j) { estado = j; ocultaAviso(); irA(5, true); })
      .catch(function (e) { aviso(e.message, "malo"); })
      .then(function () { btn.disabled = false; btn.textContent = T.aceptar; });
  });

  $("#btn-pagar").addEventListener("click", function () {
    var btn = this;
    btn.disabled = true;
    btn.textContent = T.abriendoPago;
    api("/" + token + "/pago", { method: "POST", body: "{}" })
      .then(function (j) { location.href = j.url; })
      .catch(function (e) {
        aviso(e.message, "malo");
        btn.disabled = false;
        btn.textContent = T.pagar;
      });
  });

  // Aviso del navegador si se va con cambios sin guardar.
  window.addEventListener("beforeunload", function (e) {
    if (pendiente && pasoActual < 6) { e.preventDefault(); e.returnValue = ""; }
  });

  $("#anio").textContent = String(new Date().getFullYear());
  inicia();
})();
