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
  var repetir = 0;        // paso a guardar en cuanto termine el guardado en curso

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
    // Un correo ya guardado se confirmó al escribirlo: no se obliga a repetirlo al volver.
    var guardado = leerRuta(brief, "contacto.email");
    if (guardado && $("#c-email2")) $("#c-email2").value = guardado;
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

  // ── Horario por días ───────────────────────────────────────────────────
  // Siete listas de franjas [desde, hasta], de lunes a domingo. Vacía = cerrado.
  var horario = [[], [], [], [], [], [], []];

  function hhmm(v) { return /^\d{2}:\d{2}$/.test(v || "") ? v : ""; }

  function cargaHorario() {
    var crudo = $("#p-horario-detalle") && $("#p-horario-detalle").value;
    if (!crudo) return;
    try {
      var d = JSON.parse(crudo);
      if (!Array.isArray(d) || d.length !== 7) return;
      horario = d.map(function (f) {
        return (Array.isArray(f) ? f : []).filter(function (r) {
          return Array.isArray(r) && hhmm(r[0]) && hhmm(r[1]);
        });
      });
    } catch (e) { /* un detalle corrupto se ignora y se empieza de cero */ }
  }

  function volcarHorario() {
    var dias = T.dias || [];
    var valido = horario.some(function (f) { return f.length; });
    var lineas = horario.map(function (f, i) {
      if (!f.length) return dias[i] + ": " + (T.cerrado || "").toLowerCase();
      f.forEach(function (r, j) {
        if (!(r[0] && r[1] && r[0] < r[1])) valido = false;
        if (j > 0 && f[j - 1][1] && r[0] && r[0] < f[j - 1][1]) valido = false;
      });
      return dias[i] + ": " + f.map(function (r) { return r[0] + "–" + r[1]; }).join(", ");
    });
    $("#p-horario").value = valido ? lineas.join("\n") : "";
    $("#p-horario-detalle").value = JSON.stringify(horario);
    autoguardar();
  }

  function pintaHorario() {
    var cont = $("#horario");
    if (!cont) return;
    var dias = T.dias || [];
    cont.innerHTML = horario.map(function (f, i) {
      var abierto = f.length > 0;
      var franjas = abierto
        ? f.map(function (r, j) {
            var mal = r[0] && r[1] && r[0] >= r[1];
            return '<span class="h-franja' + (mal ? " h-mal" : "") + '">' +
              '<input type="time" step="900" class="h-ini" data-j="' + j + '" value="' + r[0] + '" aria-label="' + dias[i] + '">' +
              " – " +
              '<input type="time" step="900" class="h-fin" data-j="' + j + '" value="' + r[1] + '" aria-label="' + dias[i] + '">' +
              '<button type="button" class="h-quitar" data-j="' + j + '" aria-label="' + T.quitarFranja + '">×</button></span>';
          }).join("") + '<button type="button" class="h-btn h-mas">' + T.anadirFranja + "</button>"
        : '<span class="h-cerrado">' + T.cerrado + "</span>";
      return '<div class="h-dia" data-d="' + i + '">' +
        '<label class="h-nombre"><input type="checkbox" class="h-abierto"' + (abierto ? " checked" : "") + "> " + dias[i] + "</label>" +
        '<div class="h-franjas">' + franjas + "</div>" +
        (abierto ? '<button type="button" class="h-btn h-copiar">' + T.copiarTodos + "</button>" : "<span></span>") +
        "</div>";
    }).join("");
  }

  function copia(f) { return f.map(function (r) { return [r[0], r[1]]; }); }

  function aMinutos(v) { return Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5)); }
  function aHora(m) { return ("0" + Math.floor(m / 60)).slice(-2) + ":" + ("0" + (m % 60)).slice(-2); }

  /** Una franja nueva empieza una hora después de la última, para que no se solapen. */
  function franjaSiguiente(f) {
    var ultima = f[f.length - 1];
    if (!ultima || !ultima[1]) return ["09:00", "14:00"];
    var inicio = aMinutos(ultima[1]) + 60;
    if (inicio > 23 * 60) return null;
    return [aHora(inicio), aHora(Math.min(inicio + 240, 23 * 60 + 45))];
  }

  // ── Archivos adjuntos (tarifas, logotipo) ──────────────────────────────
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }

  function adjuntoMsg(clave, texto, malo) {
    var m = $('[data-msg="' + clave + '"]');
    if (!m) return;
    m.textContent = texto || "";
    m.className = "subida-msg" + (malo ? " malo" : "");
  }

  function pintaAdjuntos() {
    var archivos = (((estado && estado.brief) || {}).archivos) || {};
    $$("[data-lista]").forEach(function (lista) {
      var clave = lista.getAttribute("data-lista");
      lista.innerHTML = (archivos[clave] || []).map(function (a) {
        return "<li>📎 " + esc(a.nombre) + " <small>" + Math.max(1, Math.round(a.bytes / 1024)) + " KB</small>" +
          '<button type="button" data-quitar="' + esc(clave) + ":" + esc(a.id) + '">' + T.tarifasQuitar + "</button></li>";
      }).join("");
    });
  }

  function subeAdjuntos(input) {
    var clave = input.getAttribute("data-subir");
    if (!consiente()) { adjuntoMsg(clave, T.tarifasPrivacidad, true); input.value = ""; return; }
    var cola = Array.prototype.slice.call(input.files);
    (function sigue() {
      var f = cola.shift();
      if (!f) { adjuntoMsg(clave, ""); input.value = ""; return; }
      if (f.size > 4 * 1024 * 1024) { adjuntoMsg(clave, T.tarifasGrande, true); input.value = ""; return; }
      adjuntoMsg(clave, T.tarifasSubiendo);
      api("/" + token + "/adjuntos/" + clave, {
        method: "POST",
        headers: { "content-type": f.type || "application/octet-stream", "x-file-name": encodeURIComponent(f.name) },
        body: f,
      })
        .then(function (j) { estado = j; pintaAdjuntos(); sigue(); })
        .catch(function (e) { adjuntoMsg(clave, e.message, true); input.value = ""; });
    })();
  }

  // ── Colores corporativos ───────────────────────────────────────────────
  function hex(v) {
    v = (v || "").trim();
    return /^#?[0-9a-f]{6}$/i.test(v) ? (v.charAt(0) === "#" ? v : "#" + v).toLowerCase() : "";
  }

  function sincronizaColores() {
    $$("[data-color-de]").forEach(function (picker) {
      var v = hex($("#" + picker.getAttribute("data-color-de")).value);
      if (v) picker.value = v;
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

  function consiente() {
    var c = $("#lg-privacidad");
    return !!(c && c.checked);
  }

  function guardar(paso) {
    if (!token) return Promise.resolve();
    if (!consiente()) { marcaGuardado(T.aceptaPrivacidad, false); return Promise.resolve(); }
    if (guardando) { repetir = Math.max(repetir, paso || pasoActual); return Promise.resolve(); }
    guardando = true;
    marcaGuardado(T.guardando, false);
    return api("/" + token, {
      method: "PATCH",
      body: JSON.stringify({ brief: recogerBrief(), step: paso || pasoActual }),
    })
      .then(function (j) { estado = j; marcaGuardado(T.guardado, true); })
      .catch(function (e) { marcaGuardado(e.message, false); })
      .then(function () {
        guardando = false;
        if (repetir) { var p = repetir; repetir = 0; return guardar(p); }
      });
  }

  function autoguardar() {
    clearTimeout(pendiente);
    marcaGuardado(T.sinGuardar, false);
    pendiente = setTimeout(function () { pendiente = null; guardar(); }, 900);
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
      var bien = el.type === "checkbox" ? el.checked : !!v;
      if (bien && el.type === "email") bien = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v);
      if (bien && el.dataset.igualA) bien = v.toLowerCase() === ($("#" + el.dataset.igualA).value || "").trim().toLowerCase();
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
    if (n > pasoActual && n <= 5) { clearTimeout(pendiente); pendiente = null; guardar(n); }
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

    var logo = ($('input[name="logo"]:checked') || {}).value || "tengo";
    $$(".logo-subida").forEach(function (n) { n.classList.toggle("oculto", logo !== "tengo"); });

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
    // Los precios ya llevan el IVA: hoy se paga la puesta en marcha más el primer año.
    var base = estado.basePriceCents;
    var anual = estado.annualPriceCents;
    var filas = [
      [PRODUCTOS[estado.product].titulo + ", " + T.alta, euros(base)],
      [T.primerAno, euros(anual)],
      [T.segundoAno, euros(anual) + T.masIva],
      [T.totalHoy, euros(base + anual)],
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
    cargaHorario();
    pintaHorario();
    pintaAdjuntos();
    sincronizaColores();
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
  ["paste", "drop"].forEach(function (tipo) {
    document.addEventListener(tipo, function (e) {
      if (e.target.matches && e.target.matches("[data-sin-pegar]")) e.preventDefault();
    });
  });
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

  var cajaHorario = $("#horario");
  if (cajaHorario) {
    cajaHorario.addEventListener("change", function (e) {
      var fila = e.target.closest(".h-dia");
      if (!fila) return;
      var d = Number(fila.dataset.d);
      if (e.target.matches(".h-abierto")) {
        if (e.target.checked) {
          // Al abrir un día se copian las horas del último día abierto, como en Google.
          var previo = null;
          for (var k = d - 1; k >= 0 && !previo; k--) if (horario[k].length) previo = horario[k];
          for (var k2 = 6; k2 > d && !previo; k2--) if (horario[k2].length) previo = horario[k2];
          horario[d] = previo ? copia(previo) : [["09:00", "18:00"]];
        } else {
          horario[d] = [];
        }
        pintaHorario();
        volcarHorario();
        return;
      }
      if (e.target.matches(".h-ini, .h-fin")) {
        var j = Number(e.target.dataset.j);
        horario[d][j][e.target.matches(".h-ini") ? 0 : 1] = hhmm(e.target.value);
        var r = horario[d][j];
        e.target.closest(".h-franja").classList.toggle("h-mal", !!(r[0] && r[1] && r[0] >= r[1]));
        volcarHorario();
      }
    });
    cajaHorario.addEventListener("click", function (e) {
      var fila = e.target.closest(".h-dia");
      if (!fila) return;
      var d = Number(fila.dataset.d);
      if (e.target.matches(".h-mas")) {
        var nueva = franjaSiguiente(horario[d]);
        if (!nueva) return;
        horario[d].push(nueva);
      } else if (e.target.matches(".h-quitar")) {
        horario[d].splice(Number(e.target.dataset.j), 1);
      } else if (e.target.matches(".h-copiar")) {
        for (var k = 0; k < 7; k++) if (k !== d && horario[k].length) horario[k] = copia(horario[d]);
      } else {
        return;
      }
      pintaHorario();
      volcarHorario();
    });
  }

  $$("[data-subir]").forEach(function (input) {
    input.addEventListener("change", function () {
      if (input.files && input.files.length) subeAdjuntos(input);
    });
  });

  $$("[data-color-de]").forEach(function (picker) {
    var texto = $("#" + picker.getAttribute("data-color-de"));
    picker.addEventListener("input", function () {
      texto.value = picker.value.toUpperCase();
      autoguardar();
    });
    texto.addEventListener("input", function () {
      var v = hex(texto.value);
      if (v) picker.value = v;
    });
  });

  var dlgAyuda = $("#dlg-ayuda");
  document.addEventListener("click", function (e) {
    var quitar = e.target.closest("[data-quitar]");
    if (quitar) {
      var partes = quitar.getAttribute("data-quitar").split(":");
      quitar.disabled = true;
      api("/" + token + "/adjuntos/" + partes[0] + "/" + partes[1], { method: "DELETE" })
        .then(function (j) { estado = j; pintaAdjuntos(); adjuntoMsg(partes[0], ""); })
        .catch(function (err) { quitar.disabled = false; adjuntoMsg(partes[0], err.message, true); });
      return;
    }
    var ayuda = e.target.closest("[data-ayuda]");
    if (ayuda && dlgAyuda) {
      var tpl = $("#ayuda-" + ayuda.getAttribute("data-ayuda"));
      if (!tpl) return;
      $("#dlg-ayuda-titulo").textContent = tpl.getAttribute("data-titulo");
      $("#dlg-ayuda-texto").innerHTML = tpl.innerHTML;
      if (dlgAyuda.showModal) dlgAyuda.showModal(); else dlgAyuda.setAttribute("open", "");
    }
  });
  if (dlgAyuda) $("#dlg-ayuda-cerrar").addEventListener("click", function () { dlgAyuda.close(); });

  $("#btn-copiar").addEventListener("click", function () {
    var i = $("#enlace");
    i.select();
    navigator.clipboard.writeText(i.value).then(function () {
      $("#btn-copiar").textContent = T.copiado;
      setTimeout(function () { $("#btn-copiar").textContent = T.copiar; }, 2000);
    }).catch(function () { document.execCommand("copy"); });
  });

  // ── Enviar el enlace por email ─────────────────────────────────────────
  var dlg = $("#dlg-email");
  function dlgMensaje(texto, tipo) {
    var m = $("#dlg-msg");
    m.textContent = texto || "";
    m.className = "dlg-msg" + (tipo ? " " + tipo : "");
  }
  $("#btn-email").addEventListener("click", function () {
    var correo = $("#c-email");
    $("#dlg-email-input").value = (correo && correo.value.trim()) || $("#dlg-email-input").value;
    $("#dlg-privacidad").checked = false;
    dlgMensaje("");
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
    $("#dlg-email-input").focus();
  });
  $("#dlg-cancelar").addEventListener("click", function () { dlg.close(); });
  $("#form-email").addEventListener("submit", function (e) {
    e.preventDefault();
    var email = $("#dlg-email-input").value.trim();
    var privacidad = $("#dlg-privacidad").checked;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) { dlgMensaje(T.emailMal, "malo"); return; }
    if (!privacidad) { dlgMensaje(T.emailPrivacidad, "malo"); return; }
    var btn = $("#dlg-enviar");
    btn.disabled = true;
    btn.textContent = T.emailEnviando;
    api("/" + token + "/enlace", { method: "POST", body: JSON.stringify({ email: email, privacidad: true }) })
      .then(function () {
        dlgMensaje(T.emailEnviado, "bueno");
        if (!consiente()) { $("#lg-privacidad").checked = true; guardar(); }
        setTimeout(function () { if (dlg.open) dlg.close(); }, 2500);
      })
      .catch(function (err) { dlgMensaje(err.message, "malo"); })
      .then(function () { btn.disabled = false; btn.textContent = T.emailEnviar; });
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
