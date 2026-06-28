// ============================================================
//  TaxiDashboard — Google Apps Script (Web App)
//  Sheets-ə yazma + oxuma backend-i
//  YENİ: action=batch — bütün xanaları TƏK sorğuda yazır (sürətli sync)
// ============================================================

function _json(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
//  AVTOMATİK AYLIQ CƏDVƏL — ay bitdikdə yeni ay vərəqi yaradılır
// ============================================================
var AZ_MONTHS = ['Yanvar','Fevral','Mart','Aprel','May','Iyun','Iyul','Avqust','Sentyabr','Oktyabr','Noyabr','Dekabr'];
function _monthSheetName(d){ return AZ_MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
function _daysInMonth(d){ return new Date(d.getFullYear(), d.getMonth()+1, 0).getDate(); }
function _colLetter(n){ var s=''; while(n>0){ var m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=Math.floor((n-1)/26); } return s; }

// Ən son mövcud ay vərəqini tap (plaka şablonu üçün)
function _latestMonthSheet(ss){
  var best=null, bestKey=-1;
  ss.getSheets().forEach(function(sh){
    var p=sh.getName().split(' ');
    if(p.length===2 && AZ_MONTHS.indexOf(p[0])>=0 && /^\d{4}$/.test(p[1])){
      var key=parseInt(p[1])*100 + AZ_MONTHS.indexOf(p[0]);
      if(key>bestKey){ bestKey=key; best=sh; }
    }
  });
  return best;
}

// Verilən tarixin ayı üçün vərəq yoxdursa yaradır (idempotent)
function ensureMonthSheet(date){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var name=_monthSheetName(date);
  if(ss.getSheetByName(name)) return {created:false, name:name};

  var tmpl=_latestMonthSheet(ss);
  if(!tmpl) return {created:false, name:name, err:'şablon ay tapılmadı'};

  // Şablondan plakaları al (A sütunu, 2-ci sətirdən)
  var lastRow=tmpl.getLastRow();
  var colA=tmpl.getRange(1,1,Math.max(lastRow,1),1).getValues();
  var plates=[];
  for(var i=1;i<colA.length;i++){
    var v=String(colA[i][0]).trim();
    if(v && /\d/.test(v) && /[A-Za-z\-]/.test(v)) plates.push(v);
  }
  if(!plates.length) return {created:false, name:name, err:'plaka tapılmadı'};

  var days=_daysInMonth(date);
  var lastDayCol=_colLetter(1+days);   // gün sütunlarının sonu (day=days → sütun days+1)
  var gelirCol=_colLetter(days+2);
  var xercCol=_colLetter(days+3);
  var depoCol=_colLetter(days+4);

  // Başlıq sətri
  var header=[AZ_MONTHS[date.getMonth()]];
  for(var dn=1; dn<=days; dn++) header.push(dn);
  header.push('Gəlir','Xərclər','Yigilan depozit','Yekun','Son dəyişiklik ','Kart hesabati','Qeyd');

  var rows=[header];
  for(var idx=0; idx<plates.length; idx++){
    var r=idx+2; // sheet sətri
    var row=[plates[idx]];
    for(var dn2=1; dn2<=days; dn2++) row.push('');
    row.push('=SUM(B'+r+':'+lastDayCol+r+')');               // Gəlir
    row.push('');                                            // Xərclər
    row.push('');                                            // Yigilan depozit
    row.push('='+gelirCol+r+'-'+xercCol+r+'-'+depoCol+r);    // Yekun
    row.push('','','');                                      // Son dəyişiklik, Kart, Qeyd
    rows.push(row);
  }

  var sheet=ss.insertSheet(name, 0); // siyahının başına
  sheet.getRange(1,1,rows.length,rows[0].length).setValues(rows);
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(1);
  sheet.getRange(1,1,1,rows[0].length).setFontWeight('bold');
  SpreadsheetApp.flush();
  return {created:true, name:name, plates:plates.length, days:days};
}

// Vaxt-triggeri üçün: cari ayı təmin et (gündəlik işlədilə bilər)
function autoEnsureMonth(){ try{ ensureMonthSheet(new Date()); }catch(e){} }

function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  try { ensureMonthSheet(new Date()); } catch(err) {}  // ay bitibsə yeni ay vərəqini avtomatik yarat
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

  // ── YENİ AY: cari (və ya verilən) ayın vərəqini yarat ──
  if (action === 'newmonth') {
    var d = new Date();
    var mp = e.parameter.month; // istəyə bağlı: "Iyul 2026"
    if (mp) { var pp = String(mp).split(' '); var mi = AZ_MONTHS.indexOf(pp[0]); if (mi >= 0 && /^\d{4}$/.test(pp[1])) d = new Date(parseInt(pp[1]), mi, 1); }
    try { var res = ensureMonthSheet(d); return _json({ok:true, created:res.created, name:res.name, err:res.err||''}); }
    catch (err) { return _json({ok:false, err:String(err)}); }
  }

  // ── SHEETEXP: xərci aylıq vərəqin Xərclər sütununa + Qeyd sütununa yaz ──
  if (action === 'sheetexp') {
    const seName = e.parameter.sheet;
    const sePlate = e.parameter.plate;
    const seAmount = parseFloat(e.parameter.amount) || 0;
    const seQeyd = e.parameter.note || e.parameter.qeyd || '';
    const seTg = ss.getSheetByName(seName);
    if (!seTg) return _json({ok:false, err:'vərəq tapılmadı'});
    const seData = seTg.getDataRange().getValues();
    const seHeader = seData[0] || [];
    let xcol = -1, qcol = -1;
    for (let c = 0; c < seHeader.length; c++) {
      const h = String(seHeader[c]).trim();
      if (h === 'Xərclər') xcol = c;
      if (h === 'Qeyd') qcol = c;
    }
    if (xcol < 0) return _json({ok:false, err:'Xərclər sütunu tapılmadı'});
    for (let i = 1; i < seData.length; i++) {
      if (String(seData[i][0]).trim() === String(sePlate).trim()) {
        const rn = i + 1;
        if (seAmount) {
          const xCell = seTg.getRange(rn, xcol + 1);
          const f = xCell.getFormula();           // düstursa "=62+110", yoxsa ''
          const v = xCell.getValue();
          let nf;
          if (f) nf = f + '+' + seAmount;                          // "=62+110" -> "=62+110+52"
          else if (v === '' || v === null) nf = '=' + seAmount;     // boş -> "=52"
          else nf = '=' + v + '+' + seAmount;                      // "62" -> "=62+52"
          xCell.setFormula(nf);
        }
        if (qcol >= 0 && seQeyd) {
          const qCell = seTg.getRange(rn, qcol + 1);
          const cq = String(qCell.getValue() || '').trim();
          qCell.setValue(cq ? (cq + ', ' + seQeyd) : seQeyd);      // varsa ", " ilə əlavə et
        }
        SpreadsheetApp.flush();
        return _json({ok:true});
      }
    }
    return _json({ok:false, err:'plaka tapılmadı'});
  }

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
