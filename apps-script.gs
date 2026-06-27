// ============================================================
//  TaxiDashboard — Google Apps Script (Web App)
//  Sheets-ə yazma + oxuma backend-i
//  YENİ: action=batch — bütün xanaları TƏK sorğuda yazır (sürətli sync)
// ============================================================

function _json(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rows = [];
  const ov = ss.getSheetByName('Overrides');
  if (ov) {
    const data = ov.getDataRange().getValues();
    data.slice(1).forEach(r => {
      if (r[0]) rows.push({sheet:r[0], plate:String(r[1]), di:r[2], val:r[3], ts:r[4] ? new Date(r[4]).getTime() : 0});
    });
  }
  return _json({rows});
}

function doPost(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const action = e.parameter.action || 'daily';

  // ── BATCH: bütün günlük xanaları tək sorğuda yaz ──
  if (action === 'batch') {
    let cells;
    try { cells = JSON.parse(e.parameter.cells || '[]'); }
    catch (err) { return _json({ok:false, err:'cells JSON xətası'}); }
    if (!cells.length) return _json({ok:true, written:0, errors:[]});

    const sheetCache = {};   // sheetName -> {target, plates:[...]} (vərəq yalnız 1 dəfə oxunur)
    const ovRows = [];
    const errors = [];
    let written = 0;

    cells.forEach(c => {
      const sheetName = c.sheet, plate = String(c.plate || ''), di = parseInt(c.di), val = c.val;
      if (!sheetName || !plate || isNaN(di)) { errors.push(plate + '#' + c.di); return; }

      let cache = sheetCache[sheetName];
      if (!cache) {
        const target = ss.getSheetByName(sheetName);
        if (!target) { cache = sheetCache[sheetName] = {target:null}; }
        else {
          const last = target.getLastRow();
          const plates = last ? target.getRange(1,1,last,1).getValues().map(r => String(r[0]).trim()) : [];
          cache = sheetCache[sheetName] = {target, plates};
        }
      }
      if (!cache.target) { errors.push(sheetName + '(vərəq yox)'); return; }

      const rowIdx = cache.plates.indexOf(plate.trim());
      if (rowIdx === -1) { errors.push(plate + '(plaka yox)'); return; }

      const writeVal = (val === '' ? '' : isNaN(+val) ? val : +val);
      cache.target.getRange(rowIdx + 1, di + 2).setValue(writeVal);
      ovRows.push([sheetName, plate, di, val, new Date()]);
      written++;
    });

    if (ovRows.length) {
      let ov = ss.getSheetByName('Overrides');
      if (!ov) { ov = ss.insertSheet('Overrides'); ov.appendRow(['Sheet','Plate','DayIdx','Val','Time']); ov.setFrozenRows(1); }
      ov.getRange(ov.getLastRow() + 1, 1, ovRows.length, 5).setValues(ovRows);
    }
    return _json({ok:true, written, errors});
  }

  if (action === 'expense') {
    let rSheet = ss.getSheetByName('Rasxodlar');
    if (!rSheet) {
      rSheet = ss.insertSheet('Rasxodlar');
      rSheet.appendRow(['ID','Maşın','Tarix','Məbləğ','Kateqoriya','Qeyd','Vaxt']);
      rSheet.setFrozenRows(1);
    }
    const id    = e.parameter.id  || '';
    const isDel = e.parameter.del === 'true';
    if (isDel && id) {
      const vals = rSheet.getDataRange().getValues();
      for (let i = 1; i < vals.length; i++) {
        if (String(vals[i][0]) === id) { rSheet.deleteRow(i+1); break; }
      }
    } else {
      const plate  = e.parameter.plate  || '';
      const date   = e.parameter.date   || '';
      const amount = parseFloat(e.parameter.amount) || 0;
      const cat    = e.parameter.cat    || 'Digər';
      const note   = e.parameter.note   || '';
      if (!id || !plate || !date) {
        return _json({ok:false,err:'parametrlər çatışmır'});
      }
      const vals = rSheet.getDataRange().getValues();
      let found = false;
      for (let i = 1; i < vals.length; i++) {
        if (String(vals[i][0]) === id) {
          rSheet.getRange(i+1,1,1,7).setValues([[id,plate,date,amount,cat,note,new Date()]]);
          found = true; break;
        }
      }
      if (!found) rSheet.appendRow([id,plate,date,amount,cat,note,new Date()]);
    }
    return _json({ok:true});
  }

  // ── Tək günlük ödəniş override (köhnə məntiq — tək redaktə üçün) ──
  const sheetName = e.parameter.sheet;
  const plate     = e.parameter.plate;
  const di        = parseInt(e.parameter.di);
  const val       = e.parameter.val;
  const target    = ss.getSheetByName(sheetName);
  if (!target) return _json({ok:false,err:'vərəq tapılmadı'});
  const data = target.getDataRange().getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === plate.trim()) {
      target.getRange(i+1, di+2).setValue(val==='' ? '' : isNaN(+val) ? val : +val);
      let ov = ss.getSheetByName('Overrides');
      if (!ov) { ov = ss.insertSheet('Overrides'); ov.appendRow(['Sheet','Plate','DayIdx','Val','Time']); ov.setFrozenRows(1); }
      ov.appendRow([sheetName, plate, di, val, new Date()]);
      return _json({ok:true});
    }
  }
  return _json({ok:false,err:'plaka tapılmadı'});
}
