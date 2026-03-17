// ============================================================
// EscoExpress CRM — GAS Backend: Пасажири
// Deploy: Web App → Execute as: Me → Access: Anyone
// Розмістити в Google Sheets таблиці "Пасажири"
// ============================================================

// ===== КОНФІГУРАЦІЯ =====
var CONFIG = {
  // ID таблиці пасажирів (замінити на реальний)
  SHEET_ID: 'YOUR_SPREADSHEET_ID_HERE',
  // Назва аркуша з пасажирами
  SHEET_NAME: 'Пасажири',
  // TTL кешу в секундах
  CACHE_TTL: 300
};

// ===== КОЛОНКИ ПАСАЖИРІВ =====
var PAX_COLS = [
  'PAX_ID',
  'Дата створення',
  'Напрям',
  'Піб пасажира',
  'Телефон пасажира',
  'Адреса відправки',
  'Адреса прибуття',
  'Кількість місць',
  'Вага багажу',
  'Опис багажу',
  'Сума',
  'Валюта',
  'Завдаток',
  'Борг',
  'Форма оплати',
  'Статус оплати',
  'Статус ліда',
  'Статус CRM',
  'RTE_ID',
  'Номер авто',
  'Дата відправки',
  'Примітка',
  'Тег',
  'CLI_ID',
  'DATE_ARCHIVE',
  'ARCHIVED_BY',
  'ARCHIVE_REASON'
];

// ============================================================
// doPost — UNIVERSAL ROUTER
// ============================================================
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;
    var result;

    switch (action) {
      // READ
      case 'getPassengers':     result = apiGetPassengers(body); break;
      case 'getOnePassenger':   result = apiGetOnePassenger(body); break;
      case 'getPassengerStats': result = apiGetPassengerStats(body); break;

      // CREATE
      case 'addPassenger':      result = apiAddPassenger(body); break;

      // UPDATE
      case 'updatePassengerField': result = apiUpdatePassengerField(body); break;

      // DELETE (archive)
      case 'deletePassenger':   result = apiDeletePassenger(body); break;

      // SEARCH
      case 'searchPassengers':  result = apiSearchPassengers(body); break;

      // DUPLICATES
      case 'checkDuplicates':   result = apiCheckDuplicates(body); break;

      default:
        result = { ok: false, error: 'Unknown action: ' + action };
    }

    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      ok: false,
      error: err.message,
      stack: err.stack
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Генерація унікального ID
 */
function genId(prefix) {
  return prefix + '_' + new Date().getTime() + '_' + Math.random().toString(36).substr(2, 6);
}

/**
 * Поточна дата YYYY-MM-DD
 */
function today() {
  return Utilities.formatDate(new Date(), 'Europe/Kiev', 'yyyy-MM-dd');
}

/**
 * ISO timestamp
 */
function now() {
  return new Date().toISOString();
}

/**
 * Отримати аркуш за назвою
 */
function getSheet(sheetName) {
  var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(sheetName || CONFIG.SHEET_NAME);
  if (!sheet) throw new Error('Аркуш "' + (sheetName || CONFIG.SHEET_NAME) + '" не знайдено');
  return sheet;
}

/**
 * Нормалізація заголовків (видалення переносів рядків)
 */
function normalizeHeaders(rawHeaders) {
  return rawHeaders.map(function(h) {
    return String(h).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  });
}

/**
 * Отримати всі дані з аркуша
 */
function getAllData(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return { headers: [], data: [] };

  var rawHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var headers = normalizeHeaders(rawHeaders);
  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  return { headers: headers, data: data };
}

/**
 * Рядок масиву → об'єкт
 */
function rowToObj(headers, row) {
  var obj = {};
  for (var i = 0; i < headers.length; i++) {
    var val = row[i];
    // Конвертація дат
    if (val instanceof Date) {
      val = Utilities.formatDate(val, 'Europe/Kiev', 'dd.MM.yyyy');
    }
    obj[headers[i]] = val !== undefined && val !== null ? String(val) : '';
  }
  return obj;
}

/**
 * Об'єкт → масив значень за порядком заголовків
 */
function objToRow(headers, obj) {
  return headers.map(function(h) {
    return obj[h] !== undefined && obj[h] !== null ? obj[h] : '';
  });
}

/**
 * Знайти рядок за значенням колонки
 */
function findRow(sheet, colName, value) {
  var all = getAllData(sheet);
  var colIdx = all.headers.indexOf(colName);
  if (colIdx === -1) return null;

  for (var i = 0; i < all.data.length; i++) {
    if (String(all.data[i][colIdx]) === String(value)) {
      return {
        rowNum: i + 2, // +1 header, +1 для 1-based
        headers: all.headers,
        data: all.data[i]
      };
    }
  }
  return null;
}

/**
 * Знайти всі рядки за значенням колонки
 */
function findAllRows(sheet, colName, value) {
  var all = getAllData(sheet);
  var colIdx = all.headers.indexOf(colName);
  if (colIdx === -1) return [];

  var results = [];
  for (var i = 0; i < all.data.length; i++) {
    if (String(all.data[i][colIdx]) === String(value)) {
      results.push({
        rowNum: i + 2,
        headers: all.headers,
        data: all.data[i]
      });
    }
  }
  return results;
}

/**
 * Розрахунок боргу
 */
function calcDebt(obj) {
  var suma = parseFloat(obj['Сума']) || 0;
  var zavd = parseFloat(obj['Завдаток']) || 0;
  return Math.max(0, suma - zavd);
}

// ============================================================
// API ENDPOINTS
// ============================================================

/**
 * Отримати всіх пасажирів
 * params: { direction: 'all'|'ue'|'eu', filter: { statusLid, statusOplata, statusCrm } }
 */
function apiGetPassengers(params) {
  var sheet = getSheet();
  var all = getAllData(sheet);
  var results = [];

  for (var i = 0; i < all.data.length; i++) {
    var obj = rowToObj(all.headers, all.data[i]);

    // Пропустити порожні рядки
    if (!obj['PAX_ID'] && !obj['Піб пасажира']) continue;

    // Пропустити архів
    if (obj['Статус CRM'] === 'Архів') continue;

    // Фільтр напрямку
    var dir = params.direction || 'all';
    if (dir === 'ue' && obj['Напрям'] !== 'УК→ЄВ') continue;
    if (dir === 'eu' && obj['Напрям'] !== 'ЄВ→УК') continue;

    // Фільтри
    var filter = params.filter || {};
    if (filter.statusLid && filter.statusLid !== 'all' && obj['Статус ліда'] !== filter.statusLid) continue;
    if (filter.statusOplata && filter.statusOplata !== 'all' && obj['Статус оплати'] !== filter.statusOplata) continue;

    // Перерахувати борг
    obj['Борг'] = String(calcDebt(obj));

    results.push(obj);
  }

  return { ok: true, data: results, count: results.length };
}

/**
 * Отримати одного пасажира за PAX_ID
 * params: { pax_id }
 */
function apiGetOnePassenger(params) {
  var sheet = getSheet();
  var found = findRow(sheet, 'PAX_ID', params.pax_id);

  if (!found) {
    return { ok: false, error: 'Пасажира не знайдено: ' + params.pax_id };
  }

  var obj = rowToObj(found.headers, found.data);
  obj['Борг'] = String(calcDebt(obj));

  return { ok: true, data: obj };
}

/**
 * Статистика по пасажирах
 */
function apiGetPassengerStats(params) {
  var sheet = getSheet();
  var all = getAllData(sheet);

  var stats = {
    total: 0,
    ue: 0,
    eu: 0,
    byStatus: { 'Новий': 0, 'В роботі': 0, 'Підтверджено': 0, 'Відмова': 0 },
    byPay: { 'Оплачено': 0, 'Частково': 0, 'Не оплачено': 0 },
    totalDebt: 0,
    totalSeats: 0
  };

  for (var i = 0; i < all.data.length; i++) {
    var obj = rowToObj(all.headers, all.data[i]);
    if (!obj['PAX_ID'] && !obj['Піб пасажира']) continue;
    if (obj['Статус CRM'] === 'Архів') continue;

    stats.total++;
    if (obj['Напрям'] === 'УК→ЄВ') stats.ue++;
    else if (obj['Напрям'] === 'ЄВ→УК') stats.eu++;

    var ls = obj['Статус ліда'];
    if (stats.byStatus[ls] !== undefined) stats.byStatus[ls]++;

    var ps = obj['Статус оплати'];
    if (stats.byPay[ps] !== undefined) stats.byPay[ps]++;

    stats.totalDebt += calcDebt(obj);
    stats.totalSeats += parseInt(obj['Кількість місць']) || 0;
  }

  return { ok: true, stats: stats };
}

/**
 * Додати нового пасажира
 * params: { data: { pib, phone, addressFrom, addressTo, seats, weight, ... } }
 */
function apiAddPassenger(params) {
  var sheet = getSheet();
  var d = params.data || {};

  var paxId = genId('PAX');
  var direction = d.direction || 'УК→ЄВ';

  var obj = {};
  // Ініціалізувати всі колонки
  PAX_COLS.forEach(function(col) { obj[col] = ''; });

  // Заповнити поля
  obj['PAX_ID'] = paxId;
  obj['Дата створення'] = today();
  obj['Напрям'] = direction;
  obj['Піб пасажира'] = d.pib || d['Піб пасажира'] || '';
  obj['Телефон пасажира'] = d.phone || d['Телефон пасажира'] || '';
  obj['Адреса відправки'] = d.addressFrom || d['Адреса відправки'] || '';
  obj['Адреса прибуття'] = d.addressTo || d['Адреса прибуття'] || '';
  obj['Кількість місць'] = d.seats || d['Кількість місць'] || '1';
  obj['Вага багажу'] = d.weight || d['Вага багажу'] || '';
  obj['Опис багажу'] = d.description || d['Опис багажу'] || '';
  obj['Сума'] = d.suma || d['Сума'] || '';
  obj['Валюта'] = d.currency || d['Валюта'] || 'UAH';
  obj['Завдаток'] = d.deposit || d['Завдаток'] || '0';
  obj['Форма оплати'] = d.payForm || d['Форма оплати'] || '';
  obj['Статус оплати'] = d.payStatus || 'Не оплачено';
  obj['Статус ліда'] = 'Новий';
  obj['Статус CRM'] = 'Активний';
  obj['Примітка'] = d.note || d['Примітка'] || '';
  obj['Тег'] = d.tag || d['Тег'] || '';

  // Розрахунок боргу
  obj['Борг'] = String(calcDebt(obj));

  // Записати в таблицю
  var all = getAllData(sheet);
  var row = objToRow(all.headers.length > 0 ? all.headers : PAX_COLS, obj);
  sheet.appendRow(row);

  return { ok: true, pax_id: paxId, data: obj };
}

/**
 * Оновити поле пасажира
 * params: { pax_id, col, value }
 */
function apiUpdatePassengerField(params) {
  var sheet = getSheet();
  var found = findRow(sheet, 'PAX_ID', params.pax_id);

  if (!found) {
    return { ok: false, error: 'Пасажира не знайдено: ' + params.pax_id };
  }

  var colIdx = found.headers.indexOf(params.col);
  if (colIdx === -1) {
    return { ok: false, error: 'Колонку не знайдено: ' + params.col };
  }

  // Оновити значення
  sheet.getRange(found.rowNum, colIdx + 1).setValue(params.value);

  // Якщо змінено Сума або Завдаток — перерахувати борг
  if (params.col === 'Сума' || params.col === 'Завдаток') {
    var obj = rowToObj(found.headers, found.data);
    obj[params.col] = params.value;
    var newDebt = calcDebt(obj);
    var debtIdx = found.headers.indexOf('Борг');
    if (debtIdx !== -1) {
      sheet.getRange(found.rowNum, debtIdx + 1).setValue(String(newDebt));
    }
  }

  return { ok: true, pax_id: params.pax_id, col: params.col, value: params.value };
}

/**
 * Видалити (архівувати) пасажира
 * params: { pax_id }
 */
function apiDeletePassenger(params) {
  var sheet = getSheet();
  var found = findRow(sheet, 'PAX_ID', params.pax_id);

  if (!found) {
    return { ok: false, error: 'Пасажира не знайдено: ' + params.pax_id };
  }

  // Архівація
  var crmIdx = found.headers.indexOf('Статус CRM');
  var dateIdx = found.headers.indexOf('DATE_ARCHIVE');
  var byIdx = found.headers.indexOf('ARCHIVED_BY');

  if (crmIdx !== -1) sheet.getRange(found.rowNum, crmIdx + 1).setValue('Архів');
  if (dateIdx !== -1) sheet.getRange(found.rowNum, dateIdx + 1).setValue(now());
  if (byIdx !== -1) sheet.getRange(found.rowNum, byIdx + 1).setValue('CRM');

  return { ok: true, pax_id: params.pax_id };
}

/**
 * Пошук пасажирів
 * params: { query }
 */
function apiSearchPassengers(params) {
  var query = (params.query || '').toLowerCase().trim();
  if (!query) return { ok: true, data: [], count: 0 };

  var sheet = getSheet();
  var all = getAllData(sheet);
  var results = [];

  for (var i = 0; i < all.data.length; i++) {
    var obj = rowToObj(all.headers, all.data[i]);
    if (!obj['PAX_ID'] && !obj['Піб пасажира']) continue;
    if (obj['Статус CRM'] === 'Архів') continue;

    // Пошук по ПІБ, телефону, PAX_ID
    var searchIn = [
      obj['Піб пасажира'],
      obj['Телефон пасажира'],
      obj['PAX_ID'],
      obj['Адреса відправки'],
      obj['Адреса прибуття']
    ].join(' ').toLowerCase();

    if (searchIn.includes(query)) {
      obj['Борг'] = String(calcDebt(obj));
      results.push(obj);
    }
  }

  return { ok: true, data: results, count: results.length };
}

/**
 * Перевірка дублікатів
 * params: { pib, phone }
 */
function apiCheckDuplicates(params) {
  var sheet = getSheet();
  var all = getAllData(sheet);
  var duplicates = [];

  var pib = (params.pib || '').toLowerCase().trim();
  var phone = (params.phone || '').replace(/\s+/g, '').trim();

  if (!pib && !phone) return { ok: true, duplicates: [], count: 0 };

  for (var i = 0; i < all.data.length; i++) {
    var obj = rowToObj(all.headers, all.data[i]);
    if (!obj['PAX_ID']) continue;
    if (obj['Статус CRM'] === 'Архів') continue;

    var nameLower = (obj['Піб пасажира'] || '').toLowerCase();
    var phoneClean = (obj['Телефон пасажира'] || '').replace(/\s+/g, '');

    if ((pib && nameLower.includes(pib)) || (phone && phoneClean.includes(phone))) {
      duplicates.push(obj);
    }
  }

  return { ok: true, duplicates: duplicates, count: duplicates.length };
}

// ============================================================
// ТЕСТУВАННЯ (можна запустити вручну в редакторі GAS)
// ============================================================
function testGetPassengers() {
  var result = apiGetPassengers({ direction: 'all', filter: {} });
  Logger.log(JSON.stringify(result, null, 2));
}

function testGetStats() {
  var result = apiGetPassengerStats({});
  Logger.log(JSON.stringify(result, null, 2));
}
