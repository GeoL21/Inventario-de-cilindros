/*****************************************************************
 * INVENTARIO DE CILINDROS — CLÍNICA REINA CATALINA
 * Servidor de la PWA (Apps Script vinculado a la hoja
 * "Inventario de cilindros - CRC").
 *
 * Pestañas que usa:
 *   Registros          → historial, una fila por registro
 *   Inventario actual  → una fila por serial con su último estado
 *   Config             → listas de botones, técnicos, años PH, código
 *   Llenados           → una fila por salida a llenado (lote)
 *   Llenados cilindros → una fila por cilindro de cada lote
 *
 * Las fotos de las remisiones se guardan en la carpeta
 * "Inventario de cilindros - Remisiones" del Drive de la cuenta
 * que implementa el script (cilindrocrc).
 *
 * La PWA llama por POST con { accion, codigo, ... }.
 * Acciones: validar, config, registrar, salida, regreso, foto, borrar.
 *
 * Borrar no elimina filas: las marca en la columna "Borrado" de
 * Registros e Inventario actual, y la app deja de mostrarlas.
 *****************************************************************/

const HOJA_REG = 'Registros';
const HOJA_INV = 'Inventario actual';
const HOJA_CFG = 'Config';
const HOJA_LOT = 'Llenados';
const HOJA_LDET = 'Llenados cilindros';
const CARPETA_FOTOS = 'Inventario de cilindros - Remisiones';
const EN_LLENADO = 'En llenado';

const CAB_LOT = ['ID lote', 'Sede', 'Gas', 'Empresa', 'Fecha salida', 'Remisión salida', 'Foto salida',
  'Técnico salida', 'Cilindros', 'Fecha último regreso', 'Remisión entrada', 'Foto entrada',
  'Técnico regreso', 'Llegaron', 'En llenado', 'Días afuera', 'Estado', 'ID foto salida', 'ID foto entrada'];
const CAB_LDET = ['ID lote', 'Serial', 'Estado', 'Fecha regreso', 'Remisión entrada', 'ID regreso'];

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
    prepararColumnas();
    switch (datos.accion) {
      case 'validar':   return responder({ ok: true });
      case 'config':    return responder({ ok: true, config: configPublica(cfg), inventario: leerInventario(), lotes: leerLotes() });
      case 'registrar': return responder(registrar(datos.r, cfg));
      case 'salida':    return responder(salida(datos.l));
      case 'regreso':   return responder(regreso(datos.g));
      case 'foto':      return responder(leerFoto(datos.id));
      case 'borrar':    return responder(borrar(datos, cfg));
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
    codigo: lista('Código de acceso')[0] || '',
    codigoAdmin: lista('Código de administrador')[0] || ''
  };
}

function configPublica(cfg) {
  const c = Object.assign({}, cfg);
  delete c.codigo;
  delete c.codigoAdmin;
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
  const venceGas = leerMesAnio(r.venceGas) ? mesAnio(r.venceGas) : '';
  const estaLleno = String(r.contenido).trim().toLowerCase() === 'lleno';

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
    // Un cilindro borrado se registra como nuevo
    const borrado = fila && inv.getLastColumn() >= COL_BORRADO && String(inv.getRange(fila, COL_BORRADO).getValue()).trim();
    if (borrado) cuenta = 0;
    const anterior = fila && !borrado ? inv.getRange(fila, 14).getValue() : '';
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
    if (venceGas) ponerMesAnio(reg, reg.getLastRow(), COL_VENCE_GAS, venceGas);

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
      if (inv.getLastColumn() >= COL_BORRADO) inv.getRange(fila, COL_BORRADO).clearContent();
      // Vencimiento del gas: se pone si viene; un cilindro que no está lleno no tiene gas que venza
      if (!estaLleno) inv.getRange(fila, COL_VENCE_GAS).clearContent();
      else if (venceGas) ponerMesAnio(inv, fila, COL_VENCE_GAS, venceGas);
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
  const ancho = Math.max(inv.getLastColumn(), COL_VENCE_GAS);
  const filas = inv.getRange(2, 1, inv.getLastRow() - 1, ancho).getValues();
  const tz = Session.getScriptTimeZone();
  return filas.filter(function(f) {
    return String(f[0]).trim() && !String(f[COL_BORRADO - 1] || '').trim();
  }).map(function(f) {
    return {
      serial: String(f[0]), sede: f[1], propietario: f[2], gas: f[3], capacidad: String(f[4]),
      ph: String(f[5]), vence: String(f[6]), valvula: f[8], pintura: f[9], contenido: f[10],
      obs: f[11], tecnico: f[12],
      fecha: f[13] instanceof Date ? Utilities.formatDate(f[13], tz, "yyyy-MM-dd'T'HH:mm:ss") : '',
      registros: Number(f[14]) || 1,
      id: String(f[15] || ''),
      venceGas: String(f[COL_VENCE_GAS - 1] || '')
    };
  });
}


/***********************
 * SALIDAS A LLENADO
 ***********************/

/** Crea las pestañas de llenados si no existen. */
function hojaConCabecera(nombre, cab) {
  const libro = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = libro.getSheetByName(nombre);
  if (!hoja) {
    hoja = libro.insertSheet(nombre);
    hoja.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold')
      .setBackground('#79022C').setFontColor('#ffffff');
    hoja.setFrozenRows(1);
    if (nombre === HOJA_LOT) hoja.hideColumns(18, 2);   // ID de las fotos: solo para la app
  }
  return hoja;
}

/** "2026-10-28" → fecha a medianoche en la zona del script */
function leerFecha(txt) {
  const m = String(txt || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
}

function textoFecha(d) {
  return d instanceof Date ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd') : '';
}

/** Busca un texto exacto en una columna; devuelve el número de fila o 0. */
function buscarFila(hoja, col, texto) {
  if (!texto || hoja.getLastRow() < 2) return 0;
  const c = hoja.getRange(2, col, hoja.getLastRow() - 1, 1)
    .createTextFinder(String(texto)).matchEntireCell(true).findNext();
  return c ? c.getRow() : 0;
}

/** Carpeta de las remisiones en el Drive de la cuenta que implementa el script. */
function carpetaFotos() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('carpetaRemisiones');
  if (id) {
    try { const c = DriveApp.getFolderById(id); if (!c.isTrashed()) return c; } catch (e) { /* se crea otra */ }
  }
  const halladas = DriveApp.getFoldersByName(CARPETA_FOTOS);
  const carpeta = halladas.hasNext() ? halladas.next() : DriveApp.createFolder(CARPETA_FOTOS);
  props.setProperty('carpetaRemisiones', carpeta.getId());
  return carpeta;
}

/** Guarda la foto (data URL JPEG) y devuelve el archivo, o null si no vino foto. */
function guardarFoto(dataUrl, nombre) {
  const m = String(dataUrl || '').match(/^data:(image\/[a-z]+);base64,(.+)$/);
  if (!m) return null;
  const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], nombre + '.jpg');
  return carpetaFotos().createFile(blob);
}

/**
 * Pone la foto en la celda como chip de archivo de Drive.
 * Usa el servicio avanzado "Google Sheets API"; si no está activo,
 * deja un enlace con el texto "Remisión".
 */
function ponerChip(hoja, fila, col, archivo) {
  const url = 'https://drive.google.com/file/d/' + archivo.getId() + '/view';
  try {
    Sheets.Spreadsheets.batchUpdate({
      requests: [{
        updateCells: {
          start: { sheetId: hoja.getSheetId(), rowIndex: fila - 1, columnIndex: col - 1 },
          rows: [{ values: [{
            userEnteredValue: { stringValue: '@' },
            chipRuns: [{ startIndex: 0, chip: { richLinkProperties: { uri: url } } }]
          }] }],
          fields: 'userEnteredValue,chipRuns'
        }
      }]
    }, SpreadsheetApp.getActiveSpreadsheet().getId());
  } catch (e) {
    const texto = SpreadsheetApp.newRichTextValue().setText('Remisión').setLinkUrl(url).build();
    hoja.getRange(fila, col).setRichTextValue(texto);
  }
}

/** Cambia el contenido en Inventario actual (y deja historial), sin pisar registros más nuevos. */
function marcarContenido(serial, contenido, fecha, tecnico, origen, idHist, venceGas) {
  const libro = SpreadsheetApp.getActiveSpreadsheet();
  const inv = libro.getSheetByName(HOJA_INV);
  const fila = buscarFila(inv, 1, serial);
  if (!fila) return;
  const v = inv.getRange(fila, 1, 1, 16).getValues()[0];
  const ultimo = v[13];
  const finDelDia = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate(), 23, 59, 59);
  if (!(ultimo instanceof Date) || ultimo <= finDelDia) {
    inv.getRange(fila, 11).setValue(contenido);
    if (venceGas) ponerMesAnio(inv, fila, COL_VENCE_GAS, venceGas);
    else inv.getRange(fila, COL_VENCE_GAS).clearContent();
  }
  // Historial: misma fila que un registro, con el origen del movimiento
  const reg = libro.getSheetByName(HOJA_REG);
  reg.appendRow([
    idHist, finDelDia, v[1], tecnico, v[2], v[3], v[4], v[0], v[5], v[6], v[7], v[8], v[9], contenido, '', origen
  ]);
  if (venceGas) ponerMesAnio(reg, reg.getLastRow(), COL_VENCE_GAS, venceGas);
}

/** Pone la fórmula de días afuera y el estado de un lote. */
function formulaDias(fila) {
  return '=IF(E' + fila + '="","",IF(Q' + fila + '="Cerrado",J' + fila + ',TODAY())-E' + fila + ')';
}

function salida(l) {
  if (!l || !l.id) return { ok: false, error: 'Salida vacía.' };
  const fecha = leerFecha(l.fecha);
  const seriales = (l.seriales || []).map(function(s) { return String(s).trim().toUpperCase(); }).filter(String);
  const faltan = [];
  if (!l.sede) faltan.push('sede');
  if (!l.gas) faltan.push('gas');
  if (!l.empresa) faltan.push('empresa');
  if (!fecha) faltan.push('fecha');
  if (!String(l.remision || '').trim()) faltan.push('número de remisión');
  if (!seriales.length) faltan.push('cilindros');
  if (faltan.length) return { ok: false, error: 'Falta: ' + faltan.join(', ') + '.' };

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const lot = hojaConCabecera(HOJA_LOT, CAB_LOT);
    const det = hojaConCabecera(HOJA_LDET, CAB_LDET);
    if (buscarFila(lot, 1, l.id)) return { ok: true, repetido: true };   // reenvío del celular

    // Ningún cilindro puede estar ya en otro lote abierto
    const ocupados = [];
    if (det.getLastRow() > 1) {
      det.getRange(2, 1, det.getLastRow() - 1, 3).getValues().forEach(function(f) {
        if (f[2] === EN_LLENADO && seriales.indexOf(String(f[1]).toUpperCase()) >= 0) ocupados.push(f[1]);
      });
    }
    if (ocupados.length) {
      return { ok: false, error: 'Ya están en llenado en otro lote: ' + ocupados.join(', ') + '.' };
    }

    const fila = lot.getLastRow() + 1;
    lot.getRange(fila, 1, 1, 17).setValues([[
      l.id, l.sede, l.gas, l.empresa, fecha, String(l.remision).trim(), '', l.tecnico || '',
      seriales.length, '', '', '', '', 0, seriales.length, '', EN_LLENADO
    ]]);
    lot.getRange(fila, 5).setNumberFormat('dd/MM/yyyy');
    lot.getRange(fila, 10).setNumberFormat('dd/MM/yyyy');
    lot.getRange(fila, 6).setNumberFormat('@');
    lot.getRange(fila, 16).setFormula(formulaDias(fila));

    det.getRange(det.getLastRow() + 1, 1, seriales.length, 6).setValues(seriales.map(function(s) {
      return [l.id, s, EN_LLENADO, '', '', ''];
    }));

    const foto = guardarFoto(l.foto, 'Remision_salida_' + String(l.remision).trim() + '_' + l.fecha);
    if (foto) {
      lot.getRange(fila, 18).setValue(foto.getId());
      ponerChip(lot, fila, 7, foto);
    }

    seriales.forEach(function(s) {
      marcarContenido(s, EN_LLENADO, fecha, l.tecnico || '', 'Salida a llenado ' + l.id, l.id + '-' + s);
    });
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function regreso(g) {
  if (!g || !g.id || !g.lote) return { ok: false, error: 'Regreso vacío.' };
  const fecha = leerFecha(g.fecha);
  const llegaron = (g.llegaron || []).map(function(s) { return String(s).trim().toUpperCase(); }).filter(String);
  const faltan = [];
  if (!fecha) faltan.push('fecha');
  if (!String(g.remision || '').trim()) faltan.push('número de remisión');
  if (!llegaron.length) faltan.push('cilindros que llegaron');
  if (faltan.length) return { ok: false, error: 'Falta: ' + faltan.join(', ') + '.' };
  const venceLote = leerMesAnio(g.venceGas) ? mesAnio(g.venceGas) : '';
  const porCilindro = g.venceCil || {};

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const lot = hojaConCabecera(HOJA_LOT, CAB_LOT);
    const det = hojaConCabecera(HOJA_LDET, CAB_LDET);
    if (buscarFila(det, 6, g.id)) return { ok: true, repetido: true };   // reenvío del celular
    const fila = buscarFila(lot, 1, g.lote);
    if (!fila) return { ok: false, error: 'No se encontró la salida ' + g.lote + '.' };

    const remision = String(g.remision).trim();
    if (String(det.getRange(1, 7).getValue()) !== 'Vence gas') det.getRange(1, 7).setValue('Vence gas').setFontWeight('bold');
    const filas = det.getRange(2, 1, det.getLastRow() - 1, 6).getValues();
    let marcados = 0;
    filas.forEach(function(f, i) {
      if (f[0] !== g.lote || f[2] !== EN_LLENADO) return;
      const serial = String(f[1]).toUpperCase();
      if (llegaron.indexOf(serial) < 0) return;
      const vence = leerMesAnio(porCilindro[serial]) ? mesAnio(porCilindro[serial]) : venceLote;
      det.getRange(i + 2, 3, 1, 4).setValues([['Llegó lleno', fecha, remision, g.id]]);
      det.getRange(i + 2, 4).setNumberFormat('dd/MM/yyyy');
      if (vence) ponerMesAnio(det, i + 2, 7, vence);
      marcarContenido(String(f[1]), 'Lleno', fecha, g.tecnico || '', 'Regreso de llenado ' + g.lote, g.id + '-' + f[1], vence);
      marcados++;
    });

    // Totales del lote
    let llegados = 0, pendientes = 0;
    det.getRange(2, 1, det.getLastRow() - 1, 3).getValues().forEach(function(f) {
      if (f[0] !== g.lote) return;
      if (f[2] === EN_LLENADO) pendientes++; else llegados++;
    });
    const remAnterior = String(lot.getRange(fila, 11).getValue() || '');
    const remisiones = remAnterior && remAnterior.split(', ').indexOf(remision) < 0 ? remAnterior + ', ' + remision : (remAnterior || remision);
    lot.getRange(fila, 10).setValue(fecha).setNumberFormat('dd/MM/yyyy');
    lot.getRange(fila, 11).setNumberFormat('@').setValue(remisiones);
    lot.getRange(fila, 13, 1, 3).setValues([[g.tecnico || '', llegados, pendientes]]);
    lot.getRange(fila, 17).setValue(pendientes ? EN_LLENADO : 'Cerrado');

    const foto = guardarFoto(g.foto, 'Remision_entrada_' + remision + '_' + g.fecha);
    if (foto) {
      lot.getRange(fila, 19).setValue(foto.getId());
      ponerChip(lot, fila, 12, foto);
    }
    return { ok: true, marcados: marcados };
  } finally {
    lock.releaseLock();
  }
}

/** Lotes abiertos y los cerrados de los últimos 120 días, con sus cilindros. */
function leerLotes() {
  const libro = SpreadsheetApp.getActiveSpreadsheet();
  const lot = libro.getSheetByName(HOJA_LOT);
  const det = libro.getSheetByName(HOJA_LDET);
  if (!lot || lot.getLastRow() < 2) return [];
  const limite = new Date(Date.now() - 120 * 86400000);
  const cil = {};
  if (det && det.getLastRow() > 1) {
    det.getRange(2, 1, det.getLastRow() - 1, 7).getValues().forEach(function(f) {
      (cil[f[0]] = cil[f[0]] || []).push({ serial: String(f[1]), estado: f[2], regreso: textoFecha(f[3]), venceGas: String(f[6] || '') });
    });
  }
  return lot.getRange(2, 1, lot.getLastRow() - 1, 19).getValues()
    .filter(function(f) {
      return f[0] && (f[16] !== 'Cerrado' || !(f[9] instanceof Date) || f[9] >= limite);
    })
    .map(function(f) {
      return {
        id: String(f[0]), sede: f[1], gas: f[2], empresa: f[3], salida: textoFecha(f[4]),
        remSalida: String(f[5]), tecnico: f[7], regreso: textoFecha(f[9]), remEntrada: String(f[10]),
        estado: f[16], fotoSalida: String(f[17] || ''), fotoEntrada: String(f[18] || ''),
        cil: cil[f[0]] || []
      };
    });
}

/** Devuelve una foto de remisión, solo si está en la carpeta de remisiones. */
function leerFoto(id) {
  let archivo;
  try { archivo = DriveApp.getFileById(String(id || '')); } catch (e) { return { ok: false, error: 'No se encontró la foto.' }; }
  const carpeta = carpetaFotos().getId();
  const padres = archivo.getParents();
  let enCarpeta = false;
  while (padres.hasNext()) if (padres.next().getId() === carpeta) enCarpeta = true;
  if (!enCarpeta) return { ok: false, error: 'Esa foto no es una remisión.' };
  const blob = archivo.getBlob();
  return { ok: true, foto: 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes()) };
}

/** Ejecuta esta función una vez desde el editor para autorizar Drive y crear las pestañas. */
function prepararLlenados() {
  hojaConCabecera(HOJA_LOT, CAB_LOT);
  hojaConCabecera(HOJA_LDET, CAB_LDET);
  Logger.log('Carpeta de remisiones: ' + carpetaFotos().getUrl());
}


/***********************
 * BORRAR (solo administrador)
 ***********************/

const COL_BORRADO = 17;   // columna "Borrado" en Registros e Inventario actual

function columnaBorrado(hoja) {
  if (String(hoja.getRange(1, COL_BORRADO).getValue()).trim() !== 'Borrado') {
    hoja.getRange(1, COL_BORRADO).setValue('Borrado').setFontWeight('bold');
  }
}

/** Es un registro hecho en la app (no historial de llenado) que sigue vigente. */
function registroVigente(f) {
  const origen = String(f[15] || '');
  return f[0] && origen.indexOf('PWA') === 0 && !String(f[COL_BORRADO - 1] || '').trim() &&
    origen.indexOf('Corregido') < 0;
}

/**
 * datos: { admin, serial, modo: 'ultimo' | 'cilindro', tecnico }
 * - ultimo: marca el último registro y el cilindro vuelve al registro anterior
 *           (si no hay anterior, sale del inventario).
 * - cilindro: marca todos sus registros y el cilindro sale del inventario.
 */
function borrar(datos, cfg) {
  if (!cfg.codigoAdmin) {
    return { ok: false, codigo: 'ADMIN', error: 'Falta el código de administrador en la pestaña Config de la hoja.' };
  }
  if (String(datos.admin || '').trim() !== cfg.codigoAdmin) {
    return { ok: false, codigo: 'ADMIN', error: 'Código de administrador incorrecto.' };
  }
  const serial = String(datos.serial || '').trim().toUpperCase();
  if (!serial) return { ok: false, error: 'Falta el serial.' };

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const libro = SpreadsheetApp.getActiveSpreadsheet();
    const reg = libro.getSheetByName(HOJA_REG);
    const inv = libro.getSheetByName(HOJA_INV);
    columnaBorrado(reg);
    columnaBorrado(inv);
    const filaInv = buscarFila(inv, 1, serial);
    if (!filaInv || String(inv.getRange(filaInv, COL_BORRADO).getValue()).trim()) {
      return { ok: false, error: serial + ' no está en el inventario.' };
    }
    const tz = Session.getScriptTimeZone();
    const marca = 'Borrado por ' + (datos.tecnico || 'administrador') + ', ' +
      Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy h:mm a');

    // Registros de este serial, del más nuevo al más viejo
    const filas = reg.getLastRow() > 1 ? reg.getRange(2, 1, reg.getLastRow() - 1, COL_VENCE_GAS).getValues() : [];
    const delSerial = [];
    filas.forEach(function(f, i) {
      if (String(f[7]).trim().toUpperCase() === serial) delSerial.push({ fila: i + 2, v: f });
    });
    const vigentes = delSerial.filter(function(x) { return registroVigente(x.v); })
      .sort(function(a, b) { return (b.v[1] instanceof Date ? b.v[1] : 0) - (a.v[1] instanceof Date ? a.v[1] : 0); });

    if (datos.modo === 'ultimo' && vigentes.length > 1) {
      reg.getRange(vigentes[0].fila, COL_BORRADO).setValue(marca);
      const p = vigentes[1].v;   // registro anterior: el cilindro vuelve a este estado
      inv.getRange(filaInv, 1, 1, 7).setValues([[serial, p[2], p[4], p[5], p[6], p[8], p[9]]]);
      inv.getRange(filaInv, 8).setFormula(formulaEstado(filaInv));
      inv.getRange(filaInv, 9, 1, 8).setValues([[p[11], p[12], p[13], p[14], p[3], p[1], vigentes.length - 1, p[0]]]);
      if (String(p[13]).trim().toLowerCase() === 'lleno' && p[COL_VENCE_GAS - 1]) {
        ponerMesAnio(inv, filaInv, COL_VENCE_GAS, String(p[COL_VENCE_GAS - 1]));
      } else {
        inv.getRange(filaInv, COL_VENCE_GAS).clearContent();
      }
      return { ok: true, quedo: 'anterior' };
    }

    // Cilindro completo (o el último era su único registro)
    delSerial.forEach(function(x) {
      if (!String(x.v[COL_BORRADO - 1] || '').trim()) reg.getRange(x.fila, COL_BORRADO).setValue(marca);
    });
    inv.getRange(filaInv, COL_BORRADO).setValue(marca);
    return { ok: true, quedo: 'fuera' };
  } finally {
    lock.releaseLock();
  }
}


/***********************
 * VENCIMIENTO DEL GAS (mes/año de la etiqueta del cilindro)
 ***********************/

const COL_VENCE_GAS = 18;   // columna "Vence gas" en Registros e Inventario actual

/** "5/2027" → "05/2027" */
function mesAnio(txt) {
  const p = leerMesAnio(txt);
  return p ? dos(p.mes) + '/' + p.anio : '';
}

/** Escribe MM/AAAA como texto, para que la hoja no lo convierta en fecha. */
function ponerMesAnio(hoja, fila, col, valor) {
  hoja.getRange(fila, col).setNumberFormat('@').setValue(valor);
}

/** Registros e Inventario actual llevan las columnas "Borrado" y "Vence gas". */
function prepararColumnas() {
  const libro = SpreadsheetApp.getActiveSpreadsheet();
  [HOJA_REG, HOJA_INV].forEach(function(nombre) {
    const hoja = libro.getSheetByName(nombre);
    if (!hoja) return;
    if (hoja.getMaxColumns() < COL_VENCE_GAS) hoja.insertColumnsAfter(hoja.getMaxColumns(), COL_VENCE_GAS - hoja.getMaxColumns());
    const cab = hoja.getRange(1, COL_BORRADO, 1, 2).getValues()[0];
    if (cab[0] !== 'Borrado' || cab[1] !== 'Vence gas') {
      hoja.getRange(1, COL_BORRADO, 1, 2).setValues([['Borrado', 'Vence gas']]).setFontWeight('bold');
    }
  });
}
