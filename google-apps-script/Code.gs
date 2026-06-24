/**
 * Kunzera — Apps Script backend (SIN Drive)
 *
 * El comprobante NO se sube a Drive. Se manda como adjunto al webhook
 * de Discord. La reserva queda registrada en el Sheet y vos ves el
 * comprobante en tu canal de Discord.
 *
 * Deploy:
 *  1) Pegar este archivo COMPLETO en el editor de Apps Script
 *  2) Guardar (Ctrl+S)
 *  3) Ejecutar setupProperties (▶) una vez
 *  4) Deploy → Manage deployments → ✎ → New version → Deploy
 */

const SHEET_ID = '1yBgdxow78biLYjd2LIwOZ0AOx5A5sgNtk206BvlD1Tw';
const SHEET_NAME = 'Reservas';
const TZ = 'America/Argentina/Buenos_Aires';

const HEADERS = [
  'Timestamp', 'Nombre', 'Whatsapp', 'Discord',
  'Plan', 'Monto', 'Turno', 'Comprobante', 'Estado', 'IdempotencyKey'
];

// ---------- Entry points ----------

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action || 'submitOrder';
    if (action === 'submitOrder') return json(submitOrder(body));
    if (action === 'updateStatus') return json(updateStatus(body));
    if (action === 'deleteOrder') return json(deleteOrder(body));
    return json({ ok: false, error: 'unknown_action' });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

function deleteOrder(body) {
  const expected = PropertiesService.getScriptProperties().getProperty('ADMIN_TOKEN');
  if (!expected || body.token !== expected) return { ok: false, error: 'unauthorized' };
  if (!body.idempotencyKey) return { ok: false, error: 'missing_idempotency_key' };

  const sheet = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: false, error: 'not_found' };

  const data = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  const idxIdem = HEADERS.indexOf('IdempotencyKey');
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][idxIdem]) === String(body.idempotencyKey)) {
      sheet.deleteRow(i + 2);
      return { ok: true, deleted: i + 2 };
    }
  }
  return { ok: false, error: 'not_found' };
}

function updateStatus(body) {
  const expected = PropertiesService.getScriptProperties().getProperty('ADMIN_TOKEN');
  if (!expected || body.token !== expected) return { ok: false, error: 'unauthorized' };
  if (!body.idempotencyKey) return { ok: false, error: 'missing_idempotency_key' };
  if (!body.estado) return { ok: false, error: 'missing_estado' };

  const sheet = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: false, error: 'not_found' };

  const data = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  const idxIdem = HEADERS.indexOf('IdempotencyKey');
  const idxEstado = HEADERS.indexOf('Estado') + 1; // 1-based col
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][idxIdem]) === String(body.idempotencyKey)) {
      sheet.getRange(i + 2, idxEstado).setValue(body.estado);
      return { ok: true, row: i + 2, estado: body.estado };
    }
  }
  return { ok: false, error: 'not_found' };
}

function doGet(e) {
  try {
    const action = String(e.parameter.action || '').toLowerCase();
    if (action === 'gettakenslots') {
      return json({ ok: true, slots: getTakenSlots() });
    }
    if (action === 'getorders') {
      const token = e.parameter.token || '';
      const expected = PropertiesService.getScriptProperties().getProperty('ADMIN_TOKEN');
      if (!expected || token !== expected) return json({ ok: false, error: 'unauthorized' });
      return json({ ok: true, orders: getOrders() });
    }
    if (action === 'ping') return json({ ok: true, ts: Date.now() });
    return json({ ok: false, error: 'unknown_action' });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

// ---------- Core ----------

function submitOrder(body) {
  const required = ['nombre', 'whatsapp', 'discord', 'plan', 'monto', 'turno'];
  for (let i = 0; i < required.length; i++) {
    if (!body[required[i]]) return { ok: false, error: 'missing_field', field: required[i] };
  }

  if (body.email) return { ok: false, error: 'spam_detected' };

  const sheet = getSheet();

  if (body.idempotencyKey) {
    const existing = findByIdempotency(sheet, body.idempotencyKey);
    if (existing) {
      return { ok: true, fileUrl: existing.comprobante || '', timestamp: existing.timestamp, replay: true };
    }
  }

  const taken = getTakenSlots();
  if (taken.indexOf(body.turno) !== -1) {
    return { ok: false, error: 'slot_taken' };
  }

  // Manda reserva + comprobante a Discord (incluye el archivo como adjunto)
  const discordSent = notifyDiscordWithFile(body);
  const comprobante = discordSent ? '✅ Enviado a Discord' : (body.file ? '⚠️ Archivo no enviado' : '-');

  const timestamp = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
  sheet.appendRow([
    timestamp,
    body.nombre,
    body.whatsapp,
    body.discord,
    body.plan,
    Number(body.monto) || 0,
    body.turno,
    comprobante,
    'pendiente',
    body.idempotencyKey || ''
  ]);

  // Forzar la celda Whatsapp como texto plano — evita que Sheets la interprete
  // como fórmula cuando el número empieza con "+". El admin panel del front
  // construye el link de WhatsApp desde el texto.
  try {
    const row = sheet.getLastRow();
    const waCol = HEADERS.indexOf('Whatsapp') + 1;
    const range = sheet.getRange(row, waCol);
    range.setNumberFormat('@');
    range.setValue(String(body.whatsapp || ''));
  } catch (waErr) {
    Logger.log('whatsapp plaintext skipped: ' + waErr);
  }

  return { ok: true, fileUrl: comprobante, timestamp: timestamp };
}

function formatSlotPretty(isoTurno) {
  try {
    const d = new Date(isoTurno);
    const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const dayName = days[d.getDay()];
    const date = Utilities.formatDate(d, TZ, 'dd/MM');
    const time = Utilities.formatDate(d, TZ, 'HH:mm');
    return dayName + ' ' + date + ' a las ' + time + ' hs';
  } catch (_) {
    return String(isoTurno);
  }
}

function notifyDiscordWithFile(body) {
  const url = PropertiesService.getScriptProperties().getProperty('DISCORD_WEBHOOK_URL');
  if (!url) return false;

  try {
    const montoFmt = '$' + Number(body.monto || 0).toLocaleString('es-AR');
    const turnoPretty = formatSlotPretty(body.turno);
    const content = '🎉 **Nueva reserva Kunzera**\n' +
      '> **' + body.nombre + '** — Pack ' + body.plan + ' (' + montoFmt + ')\n' +
      '> 📅 Turno: **' + turnoPretty + '**\n' +
      '> 📱 WhatsApp: ' + body.whatsapp + '\n' +
      '> 🎮 Discord: ' + body.discord;

    const payload = {
      'payload_json': JSON.stringify({ content: content })
    };

    // Si hay archivo, adjuntarlo al mensaje de Discord
    if (body.file && body.file.base64) {
      const cleanName = String(body.nombre)
        .replace(/[^a-zA-Z0-9\-_ ]/g, '')
        .trim()
        .replace(/\s+/g, '_') || 'comprobante';
      const mime = body.file.mime || 'application/octet-stream';
      const ext = mimeToExt(mime);
      const filename = cleanName + '_' + Date.now() + '.' + ext;

      const bytes = Utilities.base64Decode(body.file.base64);
      payload['file'] = Utilities.newBlob(bytes, mime, filename);
    }

    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      payload: payload,
      muteHttpExceptions: true
    });

    const code = response.getResponseCode();
    Logger.log('Discord HTTP ' + code);
    return code >= 200 && code < 300;
  } catch (err) {
    Logger.log('Discord error: ' + err);
    return false;
  }
}

function getTakenSlots() {
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const turnoIdx = HEADERS.indexOf('Turno') + 1;
  const values = sheet.getRange(2, turnoIdx, lastRow - 1, 1).getValues();
  const out = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i][0];
    if (v) out.push(String(v));
  }
  return out;
}

function getOrders() {
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const data = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  return data.map(function (row) {
    const obj = {};
    for (let i = 0; i < HEADERS.length; i++) {
      obj[HEADERS[i].toLowerCase()] = row[i] instanceof Date
        ? row[i].toISOString()
        : row[i];
    }
    return obj;
  });
}

function findByIdempotency(sheet, key) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const startRow = Math.max(2, lastRow - 20);
  const count = lastRow - startRow + 1;
  const data = sheet.getRange(startRow, 1, count, HEADERS.length).getValues();
  for (let i = data.length - 1; i >= 0; i--) {
    if (String(data[i][HEADERS.indexOf('IdempotencyKey')]) === String(key)) {
      return {
        timestamp: data[i][HEADERS.indexOf('Timestamp')],
        comprobante: data[i][HEADERS.indexOf('Comprobante')]
      };
    }
  }
  return null;
}

// ---------- Helpers ----------

function getSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function mimeToExt(mime) {
  const map = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'application/pdf': 'pdf'
  };
  return map[mime] || (mime.split('/')[1] || 'bin');
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------- Setup (correr UNA VEZ desde el editor) ----------

function setupProperties() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('ADMIN_TOKEN', '1bf8f203f7d5428c88da097596f51551');
  props.setProperty(
    'DISCORD_WEBHOOK_URL',
    'https://discordapp.com/api/webhooks/1494848097791115506/MY24Rmb1HO5oFE0x4Vt8sCLzOzZddTmDZHjE7vea1D1qSV5WSX98zzPrmaxH4IKryoA-'
  );
  Logger.log('Properties OK: ' + JSON.stringify(props.getProperties()));
}
