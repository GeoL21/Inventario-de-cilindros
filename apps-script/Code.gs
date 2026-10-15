/*****************************************************************
 * INVENTARIO DE CILINDROS — CLÍNICA REINA CATALINA
 * Servidor de la PWA (Apps Script vinculado a la hoja
 * "Inventario de cilindros - CRC").
 *
 * Pestañas que usa:
 *   Registros          → historial, una fila por registro
 *   Inventario actual  → una fila por serial con su último estado
 *   Config             → listas de botones, técnicos, años PH, código
 *
 * La PWA llama por POST con { accion, codigo, ... }.
 * Acciones: validar, config, registrar.
 *****************************************************************/

const HOJA_REG = 'Registros';
const HOJA_INV = 'Inventario actual';
const HOJA_CFG = 'Config';

function doGet() {
  return HtmlService.createHtmlOutput(
    '<p style="font-family:sans-serif">Servidor del inventario de cilindros activo. ' +
    'Usa la app instalada en el celular.</p>');
}

function doPost(e) {
  let datos;
  try {
    datos = JSON.parse(e.postData.contents);
  } catch (err) {
    return responder({ ok: false, error: 'Solicitud no válida.' });
  }
  try {
    const cfg = leerConfig();
    if (!cfg.codigo || String(datos.codigo || '').trim() !== cfg.codigo) {
      return responder({ ok: false, codigo: 'ACCESO', error: 'Código de acceso incorrecto.' });
    }
    switch (datos.accion) {
      case 'validar':   return responder({ ok: true });
      case 'config':    return responder({ ok: true, config: configPublica(cfg), inventario: leerInventario() });
      case 'registrar': return responder(registrar(datos.r, cfg));
      default:          return responder({ ok: false, error: 'Acción desconocida.' });
    }
  } catch (err) {
    return responder({ ok: false, error: 'Error en el servidor: ' + err.message });
  }
}

function responder(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


/***********************
 * CONFIGURACIÓN
 ***********************/

/** Lee Config por nombre de encabezado: cada columna es una lista. */
function leerConfig() {
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_CFG);
  const valores = hoja.getDataRange().getDisplayValues();
  const cab = valores[0].map(function(t) { return String(t).trim(); });
  function lista(nombre) {
    const c = cab.indexOf(nombre);
    if (c < 0) return [];
    const out = [];
    for (let f = 1; f < valores.length; f++) {
      const v = String(valores[f][c]).trim();
      if (v) out.push(v);
    }
    return out;
  }
  const anios = parseInt(lista('Años para vencer PH')[0], 10);
  return {
    cab: cab,
    sedes: lista('Sedes'),
    tecnicos: {
      'Barranquilla': lista('Técnicos Barranquilla'),
      'Baranoa': lista('Técnicos Baranoa')
    },
    propietarios: lista('Propietarios'),
    gases: lista('Gases'),
    capacidades: lista('Capacidades usadas'),
    valvula: lista('Válvula'),
    pintura: lista('Pintura'),
    contenido: lista('Contenido'),
    aniosPH: anios > 0 ? anios : 5,
    codigo: lista('Código de acceso')[0] || ''
  };
}

function configPublica(cfg) {
  const c = Object.assign({}, cfg);
  delete c.codigo;
  delete c.cab;
  return c;
}

/** Agrega un valor nuevo al final de una columna de Config si no está. */
function recordarEnConfig(cfg, encabezado, valor) {
  valor = String(valor || '').trim();
  if (!valor) return;
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_CFG);
  const c = cfg.cab.indexOf(encabezado);
  if (c < 0) return;
  const col = hoja.getRange(2, c + 1, Math.max(hoja.getLastRow() - 1, 1), 1).getDisplayValues();
  const yaEsta = col.some(function(f) {
    return String(f[0]).trim().toLowerCase() === valor.toLowerCase();
  });
  if (yaEsta) return;
  let fila = 2;
  while (fila - 2 < col.length && String(col[fila - 2][0]).trim()) fila++;
  hoja.getRange(fila, c + 1).setNumberFormat('@').setValue(valor);
}


/***********************
 * PRUEBA HIDROSTÁTICA
 ***********************/

/** "03/2021" → { mes: 3, anio: 2021 } o null */
function leerMesAnio(txt) {
  const m = String(txt || '').trim().match(/^(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const mes = parseInt(m[1], 10), anio = parseInt(m[2], 10);
  if (mes < 1 || mes > 12) return null;
  return { mes: mes, anio: anio };
}

function dos(n) { return (n < 10 ? '0' : '') + n; }

function calcularVence(ph, anios) {
  const p = leerMesAnio(ph);
  if (!p) return '';
  return dos(p.mes) + '/' + (p.anio + anios);
}

/** Vigente hasta el último día del mes de vencimiento. */
function estadoPH(vence) {
  const v = leerMesAnio(vence);
  if (!v) return '';
  const fin = new Date(v.anio, v.mes, 1);           // primer día del mes siguiente
  const hoy = new Date();
  const en3 = new Date(hoy.getFullYear(), hoy.getMonth() + 3, hoy.getDate());
  if (fin <= hoy) return 'Vencida';
  if (fin <= en3) return 'Por vencer';
  return 'Vigente';
}

/** Fórmula para que el estado de la PH se recalcule solo cada día. */
function formulaEstado(fila) {
  const g = 'G' + fila;
  const fin = 'DATE(VALUE(RIGHT(' + g + ',4)),VALUE(LEFT(' + g + ',2))+1,1)';
  return '=IF(' + g + '="","",IF(' + fin + '<=TODAY(),"Vencida",IF(' + fin +
    '<=EDATE(TODAY(),3),"Por vencer","Vigente")))';
}


/***********************
 * REGISTRAR
 ***********************/

function registrar(r, cfg) {
  if (!r || !r.id) return { ok: false, error: 'Registro vacío.' };

  const serial = String(r.serial || '').trim().toUpperCase();
  const faltan = [];
  if (!r.sede) faltan.push('sede');
  if (!r.tecnico) faltan.push('técnico');
  if (!r.propietario) faltan.push('propietario');
  if (!r.gas) faltan.push('gas');
  if (!serial) faltan.push('serial');
  if (!leerMesAnio(r.ph)) faltan.push('prueba hidrostática (MM/AAAA)');
  if (!r.valvula) faltan.push('válvula');
  if (!r.pintura) faltan.push('pintura');
  if (!r.contenido) faltan.push('contenido');
  if (faltan.length) return { ok: false, error: 'Falta: ' + faltan.join(', ') + '.' };

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const libro = SpreadsheetApp.getActiveSpreadsheet();
    const reg = libro.getSheetByName(HOJA_REG);
    const inv = libro.getSheetByName(HOJA_INV);

    // Si el celular reenvía el mismo registro, no se duplica
    if (reg.getLastRow() > 1) {
      const repetido = reg.getRange(2, 1, reg.getLastRow() - 1, 1)
        .createTextFinder(r.id).matchEntireCell(true).findNext();
      if (repetido) return { ok: true, repetido: true };
    }

    const fecha = r.fecha ? new Date(r.fecha) : new Date();
    const ph = String(r.ph).trim();
    const vence = calcularVence(ph, cfg.aniosPH);
    const estado = estadoPH(vence);
    const capacidad = String(r.capacidad || '').trim();
    const obs = String(r.obs || '').trim();

    // Busca el serial en Inventario actual
    let fila = 0, cuenta = 0;
    if (inv.getLastRow() > 1) {
      const hallado = inv.getRange(2, 1, inv.getLastRow() - 1, 1)
        .createTextFinder(serial).matchEntireCell(true).matchCase(false).findNext();
      if (hallado) {
        fila = hallado.getRow();
        cuenta = Number(inv.getRange(fila, 15).getValue()) || 0;
      }
    }

    // Un serial solo se registra una vez por día; una corrección reemplaza al de hoy
    const anterior = fila ? inv.getRange(fila, 14).getValue() : '';
    let esCorreccion = false;
    if (anterior instanceof Date) {
      const tz = Session.getScriptTimeZone();
      const mismoDia = Utilities.formatDate(anterior, tz, 'yyyy-MM-dd') === Utilities.formatDate(fecha, tz, 'yyyy-MM-dd');
      if (mismoDia && r.corrige) {
        esCorreccion = true;
        marcarCorregido(reg, String(inv.getRange(fila, 16).getValue() || r.corrige), r.id);
      } else if (mismoDia) {
        const quien = String(inv.getRange(fila, 13).getValue() || '');
        const sede = String(inv.getRange(fila, 2).getValue() || '');
        return {
          ok: false, codigo: 'REPETIDO', serial: serial,
          error: serial + ' ya se registró hoy a las ' + Utilities.formatDate(anterior, tz, 'h:mm a') +
            (quien ? ' por ' + quien : '') + (sede ? ' en ' + sede : '') +
            '. Si hay que cambiarlo, búscalo en la app y toca "Corregir el de hoy".'
        };
      }
    }

    reg.appendRow([
      r.id, fecha, r.sede, r.tecnico, r.propietario, r.gas, capacidad,
      serial, ph, vence, estado, r.valvula, r.pintura, r.contenido, obs,
      esCorreccion ? 'PWA (corrección)' : 'PWA'
    ]);

    // Inventario actual: actualiza la fila del serial o crea una nueva
    if (!fila) fila = inv.getLastRow() + 1;

    // Si llega tarde un registro viejo (estaba en cola), no pisa uno más nuevo
    if (esCorreccion) cuenta = Math.max(cuenta - 1, 0);   // la corrección no suma registros
    if (anterior instanceof Date && anterior > fecha) {
      inv.getRange(fila, 15).setValue(cuenta + 1);
    } else {
      inv.getRange(fila, 1, 1, 7).setValues([[serial, r.sede, r.propietario, r.gas, capacidad, ph, vence]]);
      inv.getRange(fila, 8).setFormula(formulaEstado(fila));
      inv.getRange(fila, 9, 1, 8).setValues([[
        r.valvula, r.pintura, r.contenido, obs, r.tecnico, fecha, cuenta + 1, r.id
      ]]);
    }

    recordarEnConfig(cfg, 'Propietarios', r.propietario);
    recordarEnConfig(cfg, 'Gases', r.gas);
    recordarEnConfig(cfg, 'Capacidades usadas', capacidad);

    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}


/** Marca en Registros el registro reemplazado por una corrección. */
function marcarCorregido(reg, idViejo, idNuevo) {
  if (!idViejo || reg.getLastRow() < 2) return;
  const celda = reg.getRange(2, 1, reg.getLastRow() - 1, 1)
    .createTextFinder(idViejo).matchEntireCell(true).findNext();
  if (celda) reg.getRange(celda.getRow(), 16).setValue('Corregido por ' + idNuevo);
}


/***********************
 * INVENTARIO PARA LA APP
 ***********************/

function leerInventario() {
  const inv = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_INV);
  if (inv.getLastRow() < 2) return [];
  const filas = inv.getRange(2, 1, inv.getLastRow() - 1, 16).getValues();
  const tz = Session.getScriptTimeZone();
  return filas.filter(function(f) { return String(f[0]).trim(); }).map(function(f) {
    return {
      serial: String(f[0]), sede: f[1], propietario: f[2], gas: f[3], capacidad: String(f[4]),
      ph: String(f[5]), vence: String(f[6]), valvula: f[8], pintura: f[9], contenido: f[10],
      obs: f[11], tecnico: f[12],
      fecha: f[13] instanceof Date ? Utilities.formatDate(f[13], tz, "yyyy-MM-dd'T'HH:mm:ss") : '',
      registros: Number(f[14]) || 1,
      id: String(f[15] || '')
    };
  });
}
