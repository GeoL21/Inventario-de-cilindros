/*****************************************************************
 * INVENTARIO DE CILINDROS — CLÍNICA REINA CATALINA
 *
 * Cada registro se guarda primero en el celular (cola) y se sube
 * a Apps Script cuando hay conexión. Así la app sirve sin señal.
 *****************************************************************/

'use strict';

/***********************
 * VALORES POR DEFECTO
 * (se usan hasta que llega la configuración de la hoja)
 ***********************/

const CFG_INICIAL = {
  sedes: ['Barranquilla', 'Baranoa'],
  tecnicos: { 'Barranquilla': ['Jorge Ortiz', 'Kensy Díaz'], 'Baranoa': ['Kevin Gamero'] },
  propietarios: ['Clínica Reina Catalina', 'Messer'],
  gases: ['Oxígeno', 'Nitrógeno', 'Dioxicarbomed', 'Oxígeno portátil', 'Aire'],
  capacidades: [],
  valvula: ['Nueva', 'Vieja'],
  pintura: ['Buena', 'Regular', 'Mala'],
  contenido: ['Lleno', 'Vacío'],
  aniosPH: 5
};


/***********************
 * UTILIDADES
 ***********************/

const $ = function(id) { return document.getElementById(id); };

function ico(nombre, tam) {
  return '<svg class="i' + (tam ? ' ' + tam : '') + '" aria-hidden="true"><use href="#i-' + nombre + '"/></svg>';
}

function esc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function dos(n) { return (n < 10 ? '0' : '') + n; }

function nuevoId(prefijo) {
  const d = new Date();
  return prefijo + '-' + d.getFullYear() + dos(d.getMonth() + 1) + dos(d.getDate()) + '-' +
    dos(d.getHours()) + dos(d.getMinutes()) + dos(d.getSeconds()) + '-' +
    Math.random().toString(36).slice(2, 5);
}

function fechaCorta(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return dos(d.getDate()) + '/' + dos(d.getMonth() + 1) + '/' + d.getFullYear();
}

function mismoDia(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function normal(t) {
  return String(t || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

let reloj = null;
function toast(html) {
  const caja = $('toast');
  caja.innerHTML = '<div>' + html + '</div>';
  clearTimeout(reloj);
  reloj = setTimeout(function() { caja.innerHTML = ''; }, 2600);
}


/***********************
 * ALMACENAMIENTO EN EL CELULAR
 ***********************/

let bd = null;

function abrirBD() {
  return new Promise(function(resolve, reject) {
    const p = indexedDB.open('inventario-cilindros', 1);
    p.onupgradeneeded = function() { p.result.createObjectStore('datos'); };
    p.onsuccess = function() { bd = p.result; resolve(); };
    p.onerror = function() { reject(p.error); };
  });
}

function leerDato(clave) {
  return new Promise(function(resolve) {
    try {
      const r = bd.transaction('datos').objectStore('datos').get(clave);
      r.onsuccess = function() { resolve(r.result); };
      r.onerror = function() { resolve(undefined); };
    } catch (e) { resolve(undefined); }
  });
}

function guardarDato(clave, valor) {
  return new Promise(function(resolve) {
    try {
      const t = bd.transaction('datos', 'readwrite');
      t.objectStore('datos').put(valor, clave);
      t.oncomplete = function() { resolve(); };
      t.onerror = function() { resolve(); };
    } catch (e) { resolve(); }
  });
}

function ls(clave, valor) {
  try {
    if (valor === undefined) return JSON.parse(localStorage.getItem(clave) || 'null');
    if (valor === null) localStorage.removeItem(clave);
    else localStorage.setItem(clave, JSON.stringify(valor));
  } catch (e) { return null; }
}


/***********************
 * COMUNICACIÓN CON APPS SCRIPT
 ***********************/

const CLAVE_CODIGO = 'ic_codigo';

function codigoAcceso() { return ls(CLAVE_CODIGO) || ''; }

function urlConfigurada() {
  return typeof URL_APPS_SCRIPT === 'string' && /^https?:\/\/.+\/exec$/.test(URL_APPS_SCRIPT.trim());
}

/** Envía una acción. Si no hay red, el error lleva sinRed = true. */
async function llamar(accion, extra, esperaMs, codigo) {
  if (!urlConfigurada()) {
    throw new Error('Falta configurar la app: pega la URL de Apps Script en config.js.');
  }
  const control = new AbortController();
  const espera = setTimeout(function() { control.abort(); }, esperaMs || 60000);
  let respuesta;
  try {
    // Sin cabeceras: se envía como texto y el navegador no hace consulta previa
    respuesta = await fetch(URL_APPS_SCRIPT.trim(), {
      method: 'POST',
      body: JSON.stringify(Object.assign(
        { accion: accion, codigo: codigo === undefined ? codigoAcceso() : codigo }, extra || {})),
      redirect: 'follow',
      signal: control.signal
    });
  } catch (e) {
    const error = new Error('Sin conexión con el servidor.');
    error.sinRed = true;
    throw error;
  } finally {
    clearTimeout(espera);
  }
  let json;
  try {
    json = await respuesta.json();
  } catch (e) {
    throw new Error('El servidor no respondió como se esperaba. Revisa que la implementación ' +
      'de Apps Script esté publicada con acceso para "Cualquier usuario".');
  }
  if (!json.ok) {
    const error = new Error(json.error || 'El servidor rechazó el registro.');
    error.codigo = json.codigo || '';
    throw error;
  }
  return json;
}


/***********************
 * ESTADO
 ***********************/

const S = {
  cfg: CFG_INICIAL,
  inv: [],          // inventario actual descargado de la hoja
  cola: [],         // registros sin subir
  sede: '',
  tecnico: '',
  vista: 'registrar',
  f: {},            // selección del formulario
  otro: { propietario: false, gas: false },
  filtroSede: '',
  filtroEstado: 'todos',
  sincronizando: false,
  corrigiendo: null,
  filtroGas: '',
  siguiente: false,     // el formulario quedó listo para otro cilindro igual
  repetidos: ls('ic_repetidos') || [],   // avisos de registros rechazados por repetidos
  sync: { estado: '', msg: '' }
};

/** Registros propios aún en cola, con la misma forma que el inventario. */
function registrosEnCola() {
  return S.cola.filter(function(op) { return op.accion === 'registrar'; })
    .map(function(op) { return Object.assign({ pendiente: true }, op.payload.r); });
}

/** Inventario actual + lo que está en cola (lo más reciente gana). */
function inventarioCompleto() {
  const mapa = {};
  S.inv.forEach(function(c) { mapa[c.serial.toUpperCase()] = Object.assign({}, c); });
  registrosEnCola().forEach(function(r) {
    const previo = mapa[r.serial];
    if (!previo || !previo.fecha || r.fecha >= previo.fecha) {
      mapa[r.serial] = Object.assign({}, r, {
        vence: calcularVence(r.ph),
        registros: (previo ? previo.registros || 1 : 0) + (r.corrige || (previo && esDeHoy(previo)) ? 0 : 1)
      });
    }
  });
  return Object.keys(mapa).map(function(k) { return mapa[k]; });
}

/** Lista de la hoja + lo que este celular ya escribió, sin repetidos. */
function opciones(lista, usados) {
  const out = [], vistos = {};
  lista.concat(usados || []).forEach(function(v) {
    const k = normal(v);
    if (v && !vistos[k]) { vistos[k] = true; out.push(v); }
  });
  return out;
}

function usadosLocales(campo) {
  const deCola = registrosEnCola().map(function(r) { return r[campo]; });
  return (ls('ic_usados_' + campo) || []).concat(deCola);
}

function recordarUsado(campo, valor) {
  valor = String(valor || '').trim();
  if (!valor) return;
  const lista = ls('ic_usados_' + campo) || [];
  if (!lista.some(function(v) { return normal(v) === normal(valor); })) {
    lista.push(valor);
    ls('ic_usados_' + campo, lista);
  }
}


/***********************
 * PRUEBA HIDROSTÁTICA
 ***********************/

/** "03/2021" → { mes, anio } o null */
function leerMesAnio(txt) {
  const m = String(txt || '').trim().match(/^(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const mes = parseInt(m[1], 10), anio = parseInt(m[2], 10);
  if (mes < 1 || mes > 12) return null;
  return { mes: mes, anio: anio };
}

function calcularVence(ph) {
  const p = leerMesAnio(ph);
  if (!p) return '';
  return dos(p.mes) + '/' + (p.anio + (Number(S.cfg.aniosPH) || 5));
}

/** Vigente hasta el último día del mes de vencimiento. */
function estadoPH(vence) {
  const v = leerMesAnio(vence);
  if (!v) return '';
  const fin = new Date(v.anio, v.mes, 1);
  const hoy = new Date();
  const en3 = new Date(hoy.getFullYear(), hoy.getMonth() + 3, hoy.getDate());
  if (fin <= hoy) return 'Vencida';
  if (fin <= en3) return 'Por vencer';
  return 'Vigente';
}

function claseEstado(estado) {
  return estado === 'Vencida' ? 'rojo' : estado === 'Por vencer' ? 'alerta' : 'ok';
}

/** Da formato mientras se escribe: 0324 → 03/24…, 032024 → 03/2024 */
function mascaraPH(txt) {
  const d = String(txt).replace(/\D/g, '').slice(0, 6);
  return d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d;
}

/** Al salir del campo: año de 2 cifras → 20xx; mes de 1 cifra → 0x */
function completarPH(txt) {
  let m = String(txt).match(/^(\d{1,2})\/(\d{2})$/);
  if (m) return dos(parseInt(m[1], 10)) + '/20' + m[2];
  m = String(txt).match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return dos(parseInt(m[1], 10)) + '/' + m[2];
  return txt;
}

function errorPH(txt) {
  if (!txt) return 'Escribe el mes y año de la prueba.';
  const p = leerMesAnio(txt);
  if (!p) return 'Usa el formato MM/AAAA, por ejemplo 03/2024.';
  const hoy = new Date();
  if (p.anio < 1950 || p.anio > hoy.getFullYear() ||
      (p.anio === hoy.getFullYear() && p.mes > hoy.getMonth() + 1)) {
    return 'Esa fecha está en el futuro o no es válida.';
  }
  return '';
}


/***********************
 * FORMULARIO
 ***********************/

/** Pinta un grupo de botones de opción. */
function pintarChips(contenedor, valores, elegido, campo, conOtro) {
  let html = valores.map(function(v) {
    return '<button type="button" class="chip" data-campo="' + campo + '" data-valor="' + esc(v) +
      '" aria-pressed="' + (normal(v) === normal(elegido) && !S.otro[campo]) + '">' + esc(v) + '</button>';
  }).join('');
  if (conOtro) {
    html += '<button type="button" class="chip mas" data-campo="' + campo + '" data-otro="1" aria-pressed="' +
      !!S.otro[campo] + '">+ ' + (campo === 'gas' ? 'Otro' : 'Otra') + '</button>';
  }
  $(contenedor).innerHTML = html;
}

function pintarFormulario() {
  pintarChips('fPropietario', opciones(S.cfg.propietarios, usadosLocales('propietario')), S.f.propietario, 'propietario', true);
  pintarChips('fGas', opciones(S.cfg.gases, usadosLocales('gas')), S.f.gas, 'gas', true);
  pintarChips('fValvula', S.cfg.valvula, S.f.valvula, 'valvula');
  pintarChips('fPintura', S.cfg.pintura, S.f.pintura, 'pintura');
  pintarChips('fContenido', S.cfg.contenido, S.f.contenido, 'contenido');
  $('fPropietarioOtro').classList.toggle('oculto', !S.otro.propietario);
  $('fGasOtro').classList.toggle('oculto', !S.otro.gas);
  pintarCapacidades();
  pintarContador();
  pintarTiraSiguiente();
}

/** Capacidades ya usadas, las más frecuentes primero. */
function pintarCapacidades() {
  const cuenta = {};
  const nombres = {};
  function sumar(v, peso) {
    v = String(v || '').trim();
    if (!v) return;
    const k = normal(v);
    cuenta[k] = (cuenta[k] || 0) + peso;
    if (!nombres[k]) nombres[k] = v;
  }
  S.cfg.capacidades.forEach(function(v) { sumar(v, 0.5); });
  usadosLocales('capacidad').forEach(function(v) { sumar(v, 0.5); });
  inventarioCompleto().forEach(function(c) { sumar(c.capacidad, 1); });
  const lista = Object.keys(cuenta).sort(function(a, b) { return cuenta[b] - cuenta[a]; }).slice(0, 10);
  const actual = normal($('fCapacidad').value);
  $('fCapacidadUsadas').innerHTML = lista.map(function(k) {
    return '<button type="button" class="chip mini" data-capacidad="' + esc(nombres[k]) +
      '" aria-pressed="' + (k === actual) + '">' + esc(nombres[k]) + '</button>';
  }).join('');
}

function pintarContador() {
  const hoy = new Date();
  const propios = (ls('ic_hoy') || []).filter(function(f) { return mismoDia(new Date(f), hoy); });
  $('contadorHoy').textContent = propios.length
    ? 'Hoy llevas ' + propios.length + (propios.length === 1 ? ' cilindro registrado' : ' cilindros registrados') + ' en este celular.'
    : '';
}

function mostrarError(campo, msg) {
  const p = document.querySelector('[data-error="' + campo + '"]');
  if (!p) return;
  p.innerHTML = msg ? ico('alerta', 's') + esc(msg) : '';
  p.classList.toggle('oculto', !msg);
}

function limpiarErrores() {
  document.querySelectorAll('[data-error]').forEach(function(p) { p.classList.add('oculto'); });
  $('fSerial').classList.remove('mal');
  $('fPH').classList.remove('mal');
}

/** Muestra el estado de la prueba hidrostática mientras se escribe. */
function pintarEstadoPH() {
  const txt = completarPH($('fPH').value);
  const caja = $('estadoPH');
  if (!leerMesAnio(txt) || errorPH(txt)) { caja.classList.add('oculto'); return; }
  const vence = calcularVence(txt);
  const est = estadoPH(vence);
  caja.className = 'estado ' + claseEstado(est);
  caja.innerHTML = ico(est === 'Vigente' ? 'check' : 'alerta', 's') +
    (est === 'Vencida' ? 'Vencida · venció ' : est === 'Por vencer' ? 'Por vencer · vence ' : 'Vigente hasta ') + vence;
}

/** ¿Ese cilindro ya se registró hoy? */
function esDeHoy(c) {
  if (!c || !c.fecha) return false;
  const d = new Date(c.fecha);
  return !isNaN(d) && mismoDia(d, new Date());
}

function textoRepetido(c) {
  const d = new Date(c.fecha);
  const h = d.getHours(), m = d.getMinutes();
  const hora = ((h % 12) || 12) + ':' + dos(m) + (h < 12 ? ' a. m.' : ' p. m.');
  return c.serial + ' ya se registró hoy a las ' + hora +
    (c.tecnico ? ' por ' + c.tecnico : '') + (c.sede ? ' en ' + c.sede : '') + '.';
}

/** Busca el serial en el inventario y avisa si ya existe. */
function revisarSerial() {
  const serial = $('fSerial').value.trim().toUpperCase();
  const caja = $('avisoSerial');
  S.encontrado = null;
  caja.classList.remove('rojo');
  if (serial.length < 2) { caja.classList.add('oculto'); return; }
  const c = inventarioCompleto().find(function(x) { return String(x.serial).toUpperCase() === serial; });
  if (!c) { caja.classList.add('oculto'); return; }
  if (esDeHoy(c)) {
    if (corrigiendo(serial)) {
      caja.innerHTML = '<span>' + ico('editar', 's') + ' <b>Corrigiendo el registro de hoy.</b><br>' +
        'Cambia lo necesario y guarda: reemplaza al anterior.</span>' +
        '<button type="button" id="btnCancelarCorr">' + ico('x', 's') + 'Cancelar corrección</button>';
      caja.classList.remove('oculto');
      $('btnCancelarCorr').onclick = cancelarCorreccion;
      return;
    }
    caja.innerHTML = '<span>' + ico('alerta', 's') + ' ' + esc(textoRepetido(c)) + '</span>' +
      '<button type="button" id="btnCorregir">' + ico('editar', 's') + 'Corregir el de hoy</button>';
    caja.classList.add('rojo');
    caja.classList.remove('oculto');
    $('btnCorregir').onclick = function() { iniciarCorreccion(c); };
    return;
  }
  S.encontrado = c;
  caja.innerHTML =
    '<span>' + ico('reloj', 's') + ' <b>Ya registrado</b>' + (c.fecha ? ' el ' + fechaCorta(c.fecha) : '') +
    (c.pendiente ? ' (sin subir)' : '') + '<br>' +
    esc([c.sede, c.gas, c.capacidad, c.contenido].filter(Boolean).join(' · ')) +
    (c.ph ? ' · PH ' + esc(c.ph) : '') + '</span>' +
    (S.copiado === serial ? '<span>' + ico('copiar', 's') + ' Datos copiados. Revisa y elige el contenido.</span>' : '');
  caja.classList.remove('oculto');
}

/**
 * Al terminar de escribir un serial que ya existe, copia sus datos solo.
 * Devuelve true si copió.
 */
function autoCopiar() {
  const serial = $('fSerial').value.trim().toUpperCase();
  const c = S.encontrado;
  if (!c || String(c.serial).toUpperCase() !== serial || S.copiado === serial) return false;
  S.copiado = serial;
  copiarDatos(c);
  revisarSerial();
  return true;
}

function copiarDatos(c) {
  elegir('propietario', c.propietario);
  elegir('gas', c.gas);
  $('fCapacidad').value = c.capacidad || '';
  $('fPH').value = c.ph || '';
  S.f.valvula = c.valvula || '';
  S.f.pintura = c.pintura || '';
  pintarFormulario();
  pintarEstadoPH();
  limpiarErrores();
  toast(ico('copiar', 's') + 'Datos de ' + esc(c.serial) + ' copiados');
}

/** ¿Se está corrigiendo el registro de hoy de este serial? */
function corrigiendo(serial) {
  return !!(S.corrigiendo && S.corrigiendo.serial === serial);
}

/** Carga el registro de hoy completo para cambiarlo. */
function iniciarCorreccion(c) {
  S.corrigiendo = { serial: String(c.serial).toUpperCase(), id: c.id || '' };
  S.copiado = S.corrigiendo.serial;
  copiarDatos(c);
  S.f.contenido = c.contenido || '';
  $('fObs').value = c.obs || '';
  pintarFormulario();
  revisarSerial();
  toast(ico('editar', 's') + 'Corrigiendo ' + esc(c.serial));
}

function cancelarCorreccion() {
  S.corrigiendo = null;
  $('fSerial').value = '';
  $('fPH').value = '';
  $('fObs').value = '';
  S.f.valvula = S.f.pintura = S.f.contenido = '';
  S.copiado = '';
  revisarSerial();
  pintarFormulario();
  pintarEstadoPH();
  $('fSerial').focus();
}

/** Elige un valor de la lista; si no está en ella, lo pone como "Otra". */
function elegir(campo, valor) {
  if (!valor) return;
  const lista = campo === 'gas'
    ? opciones(S.cfg.gases, usadosLocales('gas'))
    : opciones(S.cfg.propietarios, usadosLocales('propietario'));
  const enLista = lista.some(function(v) { return normal(v) === normal(valor); });
  S.otro[campo] = !enLista;
  S.f[campo] = valor;
  $(campo === 'gas' ? 'fGasOtro' : 'fPropietarioOtro').value = enLista ? '' : valor;
}

/** Junta y revisa el formulario. Devuelve el registro o null. */
function leerFormulario() {
  limpiarErrores();
  const r = {
    sede: S.sede,
    tecnico: S.tecnico,
    propietario: S.otro.propietario ? $('fPropietarioOtro').value.trim() : S.f.propietario,
    gas: S.otro.gas ? $('fGasOtro').value.trim() : S.f.gas,
    capacidad: $('fCapacidad').value.trim(),
    serial: $('fSerial').value.trim().toUpperCase(),
    ph: completarPH($('fPH').value.trim()),
    valvula: S.f.valvula,
    pintura: S.f.pintura,
    contenido: S.f.contenido,
    obs: $('fObs').value.trim()
  };
  const errores = [];
  if (!r.propietario) errores.push(['propietario', S.otro.propietario ? 'Escribe el nombre de la empresa.' : 'Elige el propietario.']);
  if (!r.gas) errores.push(['gas', S.otro.gas ? 'Escribe el nombre del gas.' : 'Elige el gas.']);
  if (!r.serial) errores.push(['serial', 'Escribe el serial.']);
  const ePH = errorPH(r.ph);
  if (ePH) errores.push(['ph', ePH]);
  if (!r.valvula) errores.push(['valvula', 'Elige el estado de la válvula.']);
  if (!r.pintura) errores.push(['pintura', 'Elige el estado de la pintura.']);
  if (!r.contenido) errores.push(['contenido', 'Elige si está lleno o vacío.']);

  errores.forEach(function(e) { mostrarError(e[0], e[1]); });
  if (errores.length) {
    if (errores.some(function(e) { return e[0] === 'serial'; })) $('fSerial').classList.add('mal');
    if (ePH) $('fPH').classList.add('mal');
    const primero = document.querySelector('[data-error="' + errores[0][0] + '"]');
    primero.parentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (errores[0][0] === 'serial') $('fSerial').focus();
    if (errores[0][0] === 'ph') $('fPH').focus();
    return null;
  }
  return r;
}

/** Borra el formulario. Con todo = false deja propietario, gas y capacidad. */
function limpiarFormulario(todo) {
  $('fSerial').value = '';
  $('fPH').value = '';
  $('fObs').value = '';
  S.f.valvula = S.f.pintura = S.f.contenido = '';
  if (todo) {
    S.f.propietario = S.f.gas = '';
    S.otro = { propietario: false, gas: false };
    $('fPropietarioOtro').value = '';
    $('fGasOtro').value = '';
    $('fCapacidad').value = '';
  }
  S.copiado = '';
  S.encontrado = null;
  S.corrigiendo = null;
  limpiarErrores();
  $('avisoSerial').classList.add('oculto');
  $('estadoPH').classList.add('oculto');
  pintarFormulario();
}

/** Tras "Guardar y siguiente": muestra con qué datos sigue y cómo terminar. */
function pintarTiraSiguiente() {
  const tira = $('tiraSiguiente');
  if (!S.siguiente) { tira.classList.add('oculto'); return; }
  const prop = S.otro.propietario ? $('fPropietarioOtro').value : S.f.propietario;
  const gas = S.otro.gas ? $('fGasOtro').value : S.f.gas;
  $('tiraTexto').textContent = [prop, gas, $('fCapacidad').value.trim()].filter(Boolean).join(' · ');
  tira.classList.remove('oculto');
}

/** No hay más cilindros: deja el formulario vacío sin guardar nada. */
function terminar() {
  S.siguiente = false;
  limpiarFormulario(true);
  pintarTiraSiguiente();
  if (document.activeElement) document.activeElement.blur();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  toast(ico('check', 's') + 'Listo. Lo guardado ya quedó registrado.');
}

/** Guarda. Con "siguiente" deja propietario, gas y capacidad. */
async function guardar(siguiente) {
  const r = leerFormulario();
  if (!r) return;
  const previo = inventarioCompleto().find(function(x) { return String(x.serial).toUpperCase() === r.serial; });
  const esCorreccion = esDeHoy(previo) && corrigiendo(r.serial);
  if (esDeHoy(previo) && !esCorreccion) {
    revisarSerial();
    $('fSerial').classList.add('mal');
    toast(ico('alerta', 's') + 'Ya está registrado hoy. Usa "Corregir el de hoy".');
    $('fSerial').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  r.id = nuevoId('R');
  r.fecha = new Date().toISOString();

  if (esCorreccion) {
    // Si el de hoy aún no se ha subido, se reemplaza en el celular y listo
    const idViejo = S.corrigiendo.id || previo.id || '';
    const i = S.cola.findIndex(function(op) {
      return op.accion === 'registrar' && op.payload.r.id === idViejo;
    });
    if (i >= 0 && !(S.sincronizando && i === 0)) {
      S.cola.splice(i, 1);
    } else {
      r.corrige = idViejo || 'hoy';
    }
  }
  S.corrigiendo = null;

  recordarUsado('propietario', r.propietario);
  recordarUsado('gas', r.gas);
  recordarUsado('capacidad', r.capacidad);
  const hoy = (ls('ic_hoy') || []).filter(function(f) { return mismoDia(new Date(f), new Date()); });
  if (!esCorreccion) hoy.push(r.fecha);
  ls('ic_hoy', hoy);

  await encolar('registrar', { r: r });

  const est = estadoPH(calcularVence(r.ph));
  toast(ico('check', 's') + (esCorreccion ? 'Corregido ' : 'Guardado ') + esc(r.serial) +
    (est === 'Vencida' ? ' · PH vencida' : ''));

  if (siguiente) {
    // Lo escrito en "Otra/Otro" pasa a ser un botón elegido
    if (S.otro.propietario) { S.f.propietario = r.propietario; S.otro.propietario = false; }
    if (S.otro.gas) { S.f.gas = r.gas; S.otro.gas = false; }
  }
  limpiarFormulario(!siguiente);
  S.siguiente = siguiente;
  pintarTiraSiguiente();
  if (siguiente) {
    $('fSerial').focus({ preventScroll: true });
    $('fSerial').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  sincronizar();
}


/***********************
 * COLA Y SINCRONIZACIÓN
 ***********************/

async function encolar(accion, payload) {
  S.cola.push({ uid: nuevoId('O'), accion: accion, payload: payload, creado: new Date().toISOString() });
  await guardarDato('cola', S.cola);
  pintarFranja();
}

async function sincronizar() {
  if (S.sincronizando || !codigoAcceso() || !urlConfigurada()) { pintarFranja(); return; }
  if (!navigator.onLine && S.cola.length) { S.sync = { estado: '', msg: '' }; pintarFranja(); return; }
  S.sincronizando = true;
  S.sync = { estado: 'sube', msg: '' };
  pintarFranja();
  try {
    while (S.cola.length) {
      const op = S.cola[0];
      try {
        await llamar(op.accion, op.payload, 45000);
      } catch (e) {
        // Otro celular ya lo registró hoy: este no se sube
        if (e.codigo !== 'REPETIDO') throw e;
        S.repetidos.push(e.message);
        ls('ic_repetidos', S.repetidos);
      }
      S.cola.shift();
      await guardarDato('cola', S.cola);
      pintarFranja();
    }
    const datos = await llamar('config', {}, 45000);
    S.cfg = Object.assign({}, CFG_INICIAL, datos.config);
    S.inv = datos.inventario || [];
    await guardarDato('cfg', S.cfg);
    await guardarDato('inv', S.inv);
    ls('ic_ultima', new Date().toISOString());
    S.sync = { estado: 'ok', msg: '' };
    if (S.vista === 'registrar') pintarFormulario(); else pintarInventario();
  } catch (e) {
    if (e.sinRed) S.sync = { estado: '', msg: '' };
    else if (e.codigo === 'ACCESO') { S.sync = { estado: '', msg: '' }; ls(CLAVE_CODIGO, null); mostrarAcceso(e.message); }
    else S.sync = { estado: 'error', msg: e.message };
  } finally {
    S.sincronizando = false;
    pintarFranja();
  }
}

function pintarFranja() {
  const f = $('franja');
  const n = S.cola.length;
  let clase = '', html = '';
  if (S.repetidos.length) {
    clase = 'error';
    html = ico('alerta', 's') + '<span>No se subió por repetido: ' +
      S.repetidos.map(esc).join(' ') + '</span><button id="fEntendido">Entendido</button>';
  } else if (S.sync.estado === 'error') {
    clase = 'error';
    html = ico('alerta', 's') + '<span>' + esc(S.sync.msg) + '</span>' +
      '<button id="fReintentar">Reintentar</button>' +
      (n ? '<button id="fDescartar">Descartar</button>' : '');
  } else if (S.sync.estado === 'sube' && n) {
    clase = 'sube';
    html = ico('refrescar', 's') + '<span>Subiendo ' + n + (n === 1 ? ' registro' : ' registros') + '…</span>';
  } else if (n) {
    clase = 'espera';
    html = ico('sinred', 's') + '<span>' + n + (n === 1 ? ' registro guardado' : ' registros guardados') +
      ' en el celular. Se suben al volver la señal.</span><button id="fReintentar">Subir</button>';
  } else if (S.sync.estado === 'ok') {
    clase = 'ok';
    html = ico('nube', 's') + '<span>Todo subido a la hoja.</span>';
  }
  f.className = 'franja ' + clase + (clase ? '' : ' oculto');
  f.innerHTML = html;
  if ($('fReintentar')) $('fReintentar').onclick = function() { S.sync = { estado: '', msg: '' }; sincronizar(); };
  if ($('fDescartar')) $('fDescartar').onclick = descartarPrimero;
  if ($('fEntendido')) $('fEntendido').onclick = function() {
    S.repetidos = [];
    ls('ic_repetidos', null);
    pintarFranja();
  };
  if (S.sync.estado === 'ok') {
    clearTimeout(pintarFranja.t);
    pintarFranja.t = setTimeout(function() {
      if (S.sync.estado === 'ok') { S.sync = { estado: '', msg: '' }; pintarFranja(); }
    }, 3000);
  }
}

async function descartarPrimero() {
  const op = S.cola[0];
  if (!op) return;
  const r = op.payload.r || {};
  if (!confirm('¿Descartar el registro del serial ' + (r.serial || '') + '? No se subirá a la hoja.')) return;
  S.cola.shift();
  await guardarDato('cola', S.cola);
  S.sync = { estado: '', msg: '' };
  pintarFranja();
  sincronizar();
}


/***********************
 * INVENTARIO
 ***********************/

function pintarInventario() {
  const sedes = S.cfg.sedes;
  const todo = inventarioCompleto();
  const deSede = todo.filter(function(c) { return !S.filtroSede || c.sede === S.filtroSede; });

  $('filtroSede').innerHTML = [''].concat(sedes).map(function(s) {
    const n = todo.filter(function(c) { return !s || c.sede === s; }).length;
    return '<button type="button" class="chip mini" data-sede="' + esc(s) + '" aria-pressed="' +
      (S.filtroSede === s) + '">' + esc(s || 'Todas') + ' <span class="n">' + n + '</span></button>';
  }).join('');

  const conEstado = deSede.map(function(c) {
    return Object.assign({ est: estadoPH(c.vence || calcularVence(c.ph)) }, c);
  });
  const cuenta = {
    todos: conEstado.length,
    lleno: conEstado.filter(function(c) { return normal(c.contenido) === 'lleno'; }).length,
    vacio: conEstado.filter(function(c) { return normal(c.contenido) === 'vacio'; }).length,
    vencida: conEstado.filter(function(c) { return c.est === 'Vencida'; }).length,
    porvencer: conEstado.filter(function(c) { return c.est === 'Por vencer'; }).length
  };
  $('resumen').innerHTML =
    '<div class="cifra"><b>' + cuenta.todos + '</b><span>Total</span></div>' +
    '<div class="cifra"><b>' + cuenta.lleno + '</b><span>Llenos</span></div>' +
    '<div class="cifra"><b>' + cuenta.vacio + '</b><span>Vacíos</span></div>' +
    '<div class="cifra' + (cuenta.vencida ? ' rojo' : '') + '"><b>' + cuenta.vencida + '</b><span>PH vencida</span></div>';

  pintarPorGas(conEstado);

  // Lo que sigue (filtros y lista) respeta el gas elegido
  const deGas = conEstado.filter(function(c) { return !S.filtroGas || normal(c.gas) === normal(S.filtroGas); });
  const cuentaGas = {
    todos: deGas.length,
    lleno: deGas.filter(function(c) { return normal(c.contenido) === 'lleno'; }).length,
    vacio: deGas.filter(function(c) { return normal(c.contenido) === 'vacio'; }).length,
    vencida: deGas.filter(function(c) { return c.est === 'Vencida'; }).length,
    porvencer: deGas.filter(function(c) { return c.est === 'Por vencer'; }).length
  };
  const filtros = [['todos', S.filtroGas ? 'Todos los de ' + S.filtroGas : 'Todos'], ['lleno', 'Llenos'], ['vacio', 'Vacíos'], ['vencida', 'PH vencida'], ['porvencer', 'Por vencer']];
  $('filtroEstado').innerHTML = filtros.map(function(f) {
    return '<button type="button" class="chip mini" data-estado="' + f[0] + '" aria-pressed="' +
      (S.filtroEstado === f[0]) + '">' + esc(f[1]) + ' <span class="n">' + cuentaGas[f[0]] + '</span></button>';
  }).join('');

  const q = $('buscar').value.trim().toUpperCase();
  $('limpiarBuscar').classList.toggle('oculto', !q);
  const lista = deGas.filter(function(c) {
    if (q && String(c.serial).toUpperCase().indexOf(q) < 0) return false;
    switch (S.filtroEstado) {
      case 'lleno': return normal(c.contenido) === 'lleno';
      case 'vacio': return normal(c.contenido) === 'vacio';
      case 'vencida': return c.est === 'Vencida';
      case 'porvencer': return c.est === 'Por vencer';
      default: return true;
    }
  }).sort(function(a, b) { return String(b.fecha || '').localeCompare(String(a.fecha || '')); });

  if (!lista.length) {
    $('lista').innerHTML = '<div class="vacio">' + ico('cilindro', 'l') +
      (todo.length
        ? '<b>Sin resultados</b><span>Cambia la búsqueda o el filtro.</span>'
        : '<b>Aún no hay cilindros</b><span>Los que registres aparecerán aquí.</span>') + '</div>';
    return;
  }
  $('lista').innerHTML = lista.slice(0, 300).map(function(c) {
    return '<button type="button" class="fila" data-serial="' + esc(c.serial) + '">' +
      '<div class="txt"><b>' + esc(c.serial) + '</b><small>' +
      esc([c.gas, c.capacidad, c.propietario].filter(Boolean).join(' · ')) + '</small><small>' +
      (c.pendiente ? ico('sinred', 's') + ' Sin subir · ' : '') +
      esc((S.filtroSede ? '' : c.sede + ' · ') + fechaCorta(c.fecha) + (c.tecnico ? ' · ' + c.tecnico : '')) +
      '</small></div><div class="der">' +
      '<span class="estado vino">' + esc(c.contenido || '') + '</span>' +
      (c.est ? '<span class="estado ' + claseEstado(c.est) + '">' + (c.est === 'Vencida' ? 'Venció ' : 'Vence ') + esc(c.vence || calcularVence(c.ph)) + '</span>' : '') +
      '</div></button>';
  }).join('') + (lista.length > 300
    ? '<p class="ayuda" style="padding:12px 14px">Mostrando 300 de ' + lista.length + '. Busca por serial para ver los demás.</p>'
    : '');
}


/** Cantidad de cilindros por gas (total, llenos y vacíos) de la sede elegida. */
function pintarPorGas(cilindros) {
  const grupos = {};
  cilindros.forEach(function(c) {
    const k = normal(c.gas) || '-';
    if (!grupos[k]) grupos[k] = { gas: c.gas || 'Sin gas', total: 0, lleno: 0, vacio: 0 };
    const g = grupos[k];
    g.total++;
    if (normal(c.contenido) === 'lleno') g.lleno++;
    if (normal(c.contenido) === 'vacio') g.vacio++;
  });
  const lista = Object.keys(grupos).map(function(k) { return grupos[k]; })
    .sort(function(a, b) { return b.total - a.total || a.gas.localeCompare(b.gas); });
  if (S.filtroGas && !grupos[normal(S.filtroGas)]) S.filtroGas = '';

  const caja = $('porGas');
  if (!lista.length) { caja.classList.add('oculto'); return; }
  caja.classList.remove('oculto');
  caja.innerHTML = '<div class="tit-gas"><b>Por gas</b><small>Toca un gas para ver sus cilindros</small></div>' +
    lista.map(function(g) {
      const activo = S.filtroGas && normal(S.filtroGas) === normal(g.gas);
      return '<button type="button" class="gas" data-gas="' + esc(g.gas) + '" aria-pressed="' + !!activo + '">' +
        '<span class="nom">' + esc(g.gas) + '</span>' +
        '<span class="det">' + g.lleno + (g.lleno === 1 ? ' lleno' : ' llenos') + ' · ' +
        g.vacio + (g.vacio === 1 ? ' vacío' : ' vacíos') + '</span>' +
        '<b class="tot">' + g.total + '</b></button>';
    }).join('');
}


/***********************
 * NAVEGACIÓN Y PANTALLAS
 ***********************/

function irA(vista) {
  S.vista = vista;
  $('vRegistrar').classList.toggle('oculto', vista !== 'registrar');
  $('vInventario').classList.toggle('oculto', vista !== 'inventario');
  $('barraGuardar').classList.toggle('oculto', vista !== 'registrar');
  $('navRegistrar').setAttribute('aria-current', vista === 'registrar' ? 'page' : 'false');
  $('navInventario').setAttribute('aria-current', vista === 'inventario' ? 'page' : 'false');
  if (vista === 'inventario') {
    if (S.filtroSede === undefined) S.filtroSede = S.sede;
    pintarInventario();
  } else {
    pintarFormulario();
  }
  window.scrollTo(0, 0);
}

function mostrarPantalla(cual) {
  $('vAcceso').classList.toggle('oculto', cual !== 'acceso');
  $('vTurno').classList.toggle('oculto', cual !== 'turno');
  $('vPrincipal').classList.toggle('oculto', cual !== 'principal');
}

function mostrarAcceso(msg) {
  mostrarPantalla('acceso');
  $('avisoAcceso').innerHTML = msg ? ico('alerta', 's') + esc(msg) : '';
  $('codigoAcceso').value = '';
  setTimeout(function() { $('codigoAcceso').focus(); }, 50);
}

async function entrar() {
  const codigo = $('codigoAcceso').value.trim();
  const aviso = $('avisoAcceso');
  if (!codigo) { aviso.innerHTML = ico('alerta', 's') + 'Escribe el código.'; return; }
  aviso.innerHTML = '';
  $('btnEntrar').textContent = 'Revisando…';
  try {
    await llamar('validar', {}, 30000, codigo);
    ls(CLAVE_CODIGO, codigo);
    seguir();
    sincronizar();
  } catch (e) {
    aviso.innerHTML = ico('alerta', 's') + esc(e.sinRed
      ? 'Sin señal. Para entrar la primera vez se necesita conexión.'
      : e.message);
  } finally {
    $('btnEntrar').innerHTML = ico('candado') + 'Entrar';
  }
}

let turnoSede = '', turnoTecnico = '';

function mostrarTurno() {
  turnoSede = S.sede;
  turnoTecnico = S.tecnico;
  mostrarPantalla('turno');
  pintarTurno();
}

function pintarTurno() {
  $('turnoSedes').innerHTML = S.cfg.sedes.map(function(s) {
    return '<button type="button" class="chip" data-turno-sede="' + esc(s) + '" aria-pressed="' +
      (s === turnoSede) + '">' + ico('sede', 's') + esc(s) + '</button>';
  }).join('');
  const tecnicos = (S.cfg.tecnicos && S.cfg.tecnicos[turnoSede]) || [];
  $('turnoTecnicos').innerHTML = tecnicos.map(function(t) {
    return '<button type="button" class="chip" data-turno-tecnico="' + esc(t) + '" aria-pressed="' +
      (t === turnoTecnico) + '">' + esc(t) + '</button>';
  }).join('');
  $('turnoAyuda').classList.toggle('oculto', !!turnoSede);
}

function confirmarTurno() {
  if (!turnoSede || !turnoTecnico) {
    $('turnoAyuda').textContent = !turnoSede ? 'Elige la sede.' : 'Elige el técnico.';
    $('turnoAyuda').classList.remove('oculto');
    return;
  }
  S.sede = turnoSede;
  S.tecnico = turnoTecnico;
  S.filtroSede = turnoSede;
  ls('ic_turno', { sede: S.sede, tecnico: S.tecnico });
  seguir();
}

/** Decide qué pantalla mostrar según lo que falte. */
function seguir() {
  if (!codigoAcceso()) { mostrarAcceso(''); return; }
  if (!S.sede || !S.tecnico) { mostrarTurno(); return; }
  $('cabTurno').textContent = S.sede + ' · ' + S.tecnico;
  mostrarPantalla('principal');
  irA(S.vista);
  pintarFranja();
}


/***********************
 * EVENTOS
 ***********************/

function eventos() {
  $('btnEntrar').onclick = entrar;
  $('codigoAcceso').addEventListener('keydown', function(e) { if (e.key === 'Enter') entrar(); });

  $('vTurno').addEventListener('click', function(e) {
    const s = e.target.closest('[data-turno-sede]');
    const t = e.target.closest('[data-turno-tecnico]');
    if (s) {
      if (turnoSede !== s.dataset.turnoSede) turnoTecnico = '';
      turnoSede = s.dataset.turnoSede;
      const lista = S.cfg.tecnicos[turnoSede] || [];
      if (lista.length === 1) turnoTecnico = lista[0];
      pintarTurno();
    }
    if (t) { turnoTecnico = t.dataset.turnoTecnico; pintarTurno(); }
  });
  $('btnTurno').onclick = confirmarTurno;
  $('btnCambiarTurno').onclick = mostrarTurno;

  // Botones de opción del formulario
  $('vRegistrar').addEventListener('click', function(e) {
    const b = e.target.closest('[data-campo]');
    if (b) {
      const campo = b.dataset.campo;
      if (b.dataset.otro) {
        S.otro[campo] = true;
        S.f[campo] = '';
        pintarFormulario();
        $(campo === 'gas' ? 'fGasOtro' : 'fPropietarioOtro').focus();
      } else {
        S.f[campo] = b.dataset.valor;
        if (campo === 'propietario' || campo === 'gas') S.otro[campo] = false;
        pintarFormulario();
      }
      mostrarError(campo, '');
      return;
    }
    const cap = e.target.closest('[data-capacidad]');
    if (cap) {
      $('fCapacidad').value = cap.dataset.capacidad;
      pintarCapacidades();
    }
  });
  $('fPropietarioOtro').addEventListener('input', function() { mostrarError('propietario', ''); });
  $('fGasOtro').addEventListener('input', function() { mostrarError('gas', ''); });
  $('fCapacidad').addEventListener('input', pintarCapacidades);

  // Serial siempre en mayúsculas, sin espacios
  $('fSerial').addEventListener('input', function() {
    const el = this;
    const pos = el.selectionStart;
    const antes = el.value;
    const nuevo = antes.toUpperCase().replace(/\s+/g, '');
    if (nuevo !== antes) {
      el.value = nuevo;
      const quitados = antes.slice(0, pos).length - antes.slice(0, pos).replace(/\s+/g, '').length;
      try { el.setSelectionRange(pos - quitados, pos - quitados); } catch (err) { /* nada */ }
    }
    el.classList.remove('mal');
    mostrarError('serial', '');
    revisarSerial();
  });
  $('fSerial').addEventListener('keydown', function(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (autoCopiar() || S.copiado === this.value.trim().toUpperCase()) {
      // Ya tiene todo: cerrar teclado e ir a Contenido
      this.blur();
      $('fContenido').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      $('fPH').focus();
    }
  });
  $('fSerial').addEventListener('blur', autoCopiar);

  // Prueba hidrostática con formato automático
  $('fPH').addEventListener('input', function(e) {
    const borrando = e.inputType && e.inputType.indexOf('delete') === 0;
    let v = mascaraPH(this.value);
    if (borrando && /\/$/.test(this.value)) v = v.replace(/\/$/, '');
    this.value = v;
    this.classList.remove('mal');
    mostrarError('ph', '');
    pintarEstadoPH();
  });
  $('fPH').addEventListener('blur', function() {
    this.value = completarPH(this.value);
    pintarEstadoPH();
  });
  $('fPH').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); this.blur(); }
  });

  $('btnGuardar').onclick = function() { guardar(false); };
  $('btnSiguiente').onclick = function() { guardar(true); };

  // Navegación
  $('navRegistrar').onclick = function() { irA('registrar'); };
  $('navInventario').onclick = function() { irA('inventario'); };

  // Inventario
  $('buscar').addEventListener('input', function() {
    this.value = this.value.toUpperCase();
    pintarInventario();
  });
  $('limpiarBuscar').onclick = function() { $('buscar').value = ''; pintarInventario(); $('buscar').focus(); };
  $('vInventario').addEventListener('click', function(e) {
    const s = e.target.closest('[data-sede]');
    const est = e.target.closest('[data-estado]');
    const gas = e.target.closest('[data-gas]');
    if (gas) {
      S.filtroGas = normal(S.filtroGas) === normal(gas.dataset.gas) ? '' : gas.dataset.gas;
      pintarInventario();
      return;
    }
    const fila = e.target.closest('[data-serial]');
    if (s) { S.filtroSede = s.dataset.sede; pintarInventario(); }
    if (est) { S.filtroEstado = est.dataset.estado; pintarInventario(); }
    if (fila) {
      // Abrir el registro con ese serial para volver a revisarlo
      irA('registrar');
      $('fSerial').value = fila.dataset.serial;
      revisarSerial();
      autoCopiar();
      $('fSerial').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });

  window.addEventListener('online', sincronizar);
  window.addEventListener('offline', pintarFranja);
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') sincronizar();
  });

  $('btnTerminar').onclick = terminar;

  // Instalar la app
  window.addEventListener('beforeinstallprompt', function(e) {
    e.preventDefault();
    S.avisoInstalar = e;
    pintarInstalar();
  });
  window.addEventListener('appinstalled', function() {
    S.avisoInstalar = null;
    S.instalada = true;
    pintarInstalar();
    toast(ico('check', 's') + 'App instalada');
  });
  $('btnInstalar').onclick = instalar;
  $('btnInstalarBanner').onclick = instalar;
  $('cerrarInstalar').onclick = function() {
    ls('ic_instalar_cerrado', Date.now());
    pintarInstalar();
  };
  // Si el navegador no ofrece el botón, igual se muestran las instrucciones
  setTimeout(function() { S.esperoInstalar = true; pintarInstalar(); }, 2500);
}

function estaInstalada() {
  return S.instalada || window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
}

function pintarInstalar() {
  const cerrado = ls('ic_instalar_cerrado');
  const oculto = estaInstalada() || (cerrado && Date.now() - cerrado < 3 * 86400000) ||
    (!S.avisoInstalar && !S.esperoInstalar);
  $('bannerInstalar').classList.toggle('oculto', !!oculto);
  $('btnInstalar').classList.toggle('oculto', estaInstalada() || !S.avisoInstalar);
  $('instPasos').classList.add('oculto');
  $('btnInstalarBanner').innerHTML = S.avisoInstalar ? ico('instalar', 's') + 'Instalar' : 'Cómo instalar';
}

async function instalar() {
  if (S.avisoInstalar) {
    const e = S.avisoInstalar;
    e.prompt();
    const r = await e.userChoice;
    if (r && r.outcome === 'accepted') S.instalada = true;
    S.avisoInstalar = null;
    pintarInstalar();
    return;
  }
  // Sin aviso del navegador: explicar cómo hacerlo a mano
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  $('instPasos').innerHTML = ios
    ? 'En Safari toca <b>Compartir</b> y luego <b>Agregar a inicio</b>.'
    : 'Toca el menú <b>⋮</b> de Chrome (arriba a la derecha) y luego <b>Instalar app</b> o <b>Agregar a la pantalla principal</b>.';
  $('instPasos').classList.remove('oculto');
}


/***********************
 * ARRANQUE
 ***********************/

async function iniciar() {
  try { await abrirBD(); } catch (e) { /* sin IndexedDB: funciona solo en memoria */ }
  const cfg = await leerDato('cfg');
  if (cfg) S.cfg = Object.assign({}, CFG_INICIAL, cfg);
  S.inv = (await leerDato('inv')) || [];
  S.cola = (await leerDato('cola')) || [];
  const turno = ls('ic_turno');
  if (turno) { S.sede = turno.sede; S.tecnico = turno.tecnico; S.filtroSede = turno.sede; }

  eventos();
  seguir();
  if (codigoAcceso()) sincronizar();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function() { /* nada */ });
  }
}

iniciar();
