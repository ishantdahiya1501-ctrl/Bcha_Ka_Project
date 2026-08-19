/**
 * lib/xlsx.js — Zero-dependency Excel (.xlsx) & CSV reader/writer for Node.js.
 *
 * An .xlsx file is a ZIP archive containing XML parts. We implement just enough
 * ZIP + XML handling to read the first worksheet (shared strings + inline
 * strings + numbers) and to write simple spreadsheets. Built entirely on the
 * Node stdlib (`zlib`), so no npm packages are required.
 */
'use strict';

const zlib = require('zlib');

/* ------------------------------------------------------------------ *
 *  Small XML helpers
 * ------------------------------------------------------------------ */

function decodeXml(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

function escXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(s) {
  return escXml(s).replace(/'/g, '&apos;');
}

/** Collect all <t>...</t> runs inside an <si> or <is> block. */
function collectText(xml) {
  let out = '';
  const re = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let m;
  while ((m = re.exec(xml))) out += m[1];
  return decodeXml(out);
}

function colToNum(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n;
}

function numToCol(n) {
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/* ------------------------------------------------------------------ *
 *  ZIP reading (enough for XLSX)
 * ------------------------------------------------------------------ */

function findEOCD(buf) {
  // End Of Central Directory record: PK\x05\x06, at least 22 bytes long.
  const min = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

function readZipEntries(buf) {
  const eocd = findEOCD(buf);
  if (eocd < 0) throw new Error('Not a valid ZIP/XLSX file (no end-of-central-directory record).');
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    entries.set(name, { method, csize, localOff });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function extractEntry(buf, entry) {
  const p = entry.localOff;
  const nameLen = buf.readUInt16LE(p + 26);
  const extraLen = buf.readUInt16LE(p + 28);
  const dataStart = p + 30 + nameLen + extraLen;
  const data = buf.slice(dataStart, dataStart + entry.csize);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return zlib.inflateRawSync(data);
  throw new Error('Unsupported ZIP compression method: ' + entry.method);
}

/* ------------------------------------------------------------------ *
 *  XLSX reading
 * ------------------------------------------------------------------ */

function parseSheet(xml, shared) {
  const cells = new Map(); // key "row,col" -> value
  let maxR = 0;
  let maxC = 0;
  let pos = 0;
  while (pos < xml.length) {
    const cs = xml.indexOf('<c', pos);
    if (cs === -1) break;
    const tagEnd = xml.indexOf('>', cs);
    if (tagEnd === -1) break;
    const tag = xml.slice(cs, tagEnd + 1);
    const selfClosing = /\/>$/.test(tag);
    const rMatch = tag.match(/r="([A-Z]+)(\d+)"/);
    let inner = '';
    if (!selfClosing) {
      const ce = xml.indexOf('</c>', tagEnd);
      inner = ce === -1 ? '' : xml.slice(tagEnd + 1, ce);
      pos = ce === -1 ? tagEnd + 1 : ce + 4;
    } else {
      pos = tagEnd + 1;
    }
    if (!rMatch) continue;
    const col = colToNum(rMatch[1]);
    const row = parseInt(rMatch[2], 10);
    const tMatch = tag.match(/t="([^"]+)"/);
    const type = tMatch ? tMatch[1] : '';
    let val = '';
    if (type === 'inlineStr') {
      val = collectText(inner);
    } else if (type === 's') {
      const v = inner.match(/<v>([\s\S]*?)<\/v>/);
      if (v) {
        const idx = parseInt(v[1], 10);
        val = shared[idx] != null ? shared[idx] : '';
      }
    } else {
      const v = inner.match(/<v>([\s\S]*?)<\/v>/);
      if (v) val = decodeXml(v[1]);
    }
    cells.set(row + ',' + col, val);
    if (row > maxR) maxR = row;
    if (col > maxC) maxC = col;
  }
  const out = [];
  for (let r = 1; r <= maxR; r++) {
    const rowArr = [];
    let empty = true;
    for (let c = 1; c <= maxC; c++) {
      const v = cells.get(r + ',' + c) || '';
      rowArr.push(v);
      if (v !== '') empty = false;
    }
    if (!empty) out.push(rowArr);
  }
  return out;
}

/**
 * Parse an .xlsx buffer into a 2-D array of strings (first worksheet).
 */
function readXlsx(buf) {
  const entries = readZipEntries(buf);
  const names = [...entries.keys()];
  const get = (n) => extractEntry(buf, entries.get(n));

  // Locate worksheet files via workbook.xml.rels (fall back to sheet1.xml)
  let sheetPaths = [];
  const relsName = names.find((n) => /xl\/_rels\/workbook\.xml\.rels$/i.test(n));
  if (relsName) {
    const relMap = new Map();
    const relRe = /<Relationship\b[^>]*>/g;
    let m;
    const rels = get(relsName).toString('utf8');
    while ((m = relRe.exec(rels))) {
      const id = m[0].match(/Id="([^"]+)"/);
      const target = m[0].match(/Target="([^"]+)"/);
      if (id && target && /worksheet/i.test(target[1])) {
        relMap.set(id[1], target[1].replace(/^\//, ''));
      }
    }
    const wbName = names.find((n) => /xl\/workbook\.xml$/i.test(n));
    if (wbName) {
      const wb = get(wbName).toString('utf8');
      const sheetRe = /<sheet\b[^>]*>/g;
      let sm;
      while ((sm = sheetRe.exec(wb))) {
        const nm = sm[0].match(/name="([^"]+)"/);
        const rid = sm[0].match(/r:id="([^"]+)"/);
        if (nm && rid) sheetPaths.push({ name: nm[1], path: relMap.get(rid[1]) });
      }
    }
  }
  if (!sheetPaths.length) {
    sheetPaths = names
      .filter((n) => /xl\/worksheets\/sheet\d+\.xml$/i.test(n))
      .sort()
      .map((n) => ({ name: n, path: n }));
  }
  if (!sheetPaths.length) throw new Error('No worksheet found in the XLSX file.');

  // Shared strings table
  const shared = [];
  const ssName = names.find((n) => /xl\/sharedStrings\.xml$/i.test(n));
  if (ssName) {
    const ssXml = get(ssName).toString('utf8');
    const siRe = /<si>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = siRe.exec(ssXml))) shared.push(collectText(m[1]));
  }

  const sheetXml = get(sheetPaths[0].path).toString('utf8');
  return { sheetName: sheetPaths[0].name, rows: parseSheet(sheetXml, shared) };
}

/* ------------------------------------------------------------------ *
 *  ZIP writing (enough to create XLSX files)
 * ------------------------------------------------------------------ */

function makeCrcTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}
const CRC_TABLE = makeCrcTable();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Create a ZIP archive from an array of [name, Buffer] pairs.
 */
function zip(files) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const comp = zlib.deflateRawSync(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // method: deflate
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0, 12); // mod date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra len

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(8, 10); // method
    central.writeUInt16LE(0, 12); // mod time
    central.writeUInt16LE(0, 14); // mod date
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra len
    central.writeUInt16LE(0, 32); // comment len
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42); // local header offset

    localChunks.push(local, nameBuf, comp);
    centralChunks.push(central, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }

  const centralBuf = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with central dir
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // comment len

  return Buffer.concat([...localChunks, centralBuf, eocd]);
}

/* ------------------------------------------------------------------ *
 *  XLSX writing
 * ------------------------------------------------------------------ */

/**
 * Write one or more worksheets to an .xlsx buffer.
 * @param {Array<{name: string, rows: Array<Array<string|number>>}>} sheets
 */
function writeXlsx(sheets) {
  const files = [];
  const ctParts = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
  ];
  sheets.forEach((s, i) => {
    ctParts.push(
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    );
  });
  ctParts.push('</Types>');
  files.push(['[Content_Types].xml', Buffer.from(ctParts.join(''))]);

  const rels = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
  ];
  sheets.forEach((s, i) => {
    rels.push(
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
    );
  });
  rels.push('</Relationships>');
  files.push(['xl/_rels/workbook.xml.rels', Buffer.from(rels.join(''))]);

  const wb = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>',
  ];
  sheets.forEach((s, i) => {
    wb.push(`<sheet name="${escAttr(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`);
  });
  wb.push('</sheets></workbook>');
  files.push(['xl/workbook.xml', Buffer.from(wb.join(''))]);

  sheets.forEach((s, i) => {
    let xml = [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>',
    ];
    s.rows.forEach((rowArr, ri) => {
      let cells = '';
      rowArr.forEach((val, ci) => {
        if (val === null || val === undefined || val === '') return;
        const ref = numToCol(ci + 1) + (ri + 1);
        cells += `<c r="${ref}" t="inlineStr"><is><t>${escXml(String(val))}</t></is></c>`;
      });
      if (cells) xml.push(`<row r="${ri + 1}">${cells}</row>`);
    });
    xml.push('</sheetData></worksheet>');
    files.push([`xl/worksheets/sheet${i + 1}.xml`, Buffer.from(xml.join(''))]);
  });

  return zip(files);
}

/* ------------------------------------------------------------------ *
 *  CSV reading / writing
 * ------------------------------------------------------------------ */

function readCsv(str) {
  // Strip UTF-8 BOM so the first header cell isn't corrupted
  if (str.charCodeAt(0) === 0xfeff) str = str.slice(1);
  const rows = [];
  let row = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (inQ) {
      if (ch === '"') {
        if (str[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ',') {
      row.push(cur); cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && str[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else {
      cur += ch;
    }
  }
  row.push(cur);
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

function writeCsv(rows) {
  return rows
    .map((r) =>
      r
        .map((c) => {
          const s = c == null ? '' : String(c);
          return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        })
        .join(',')
    )
    .join('\r\n');
}

/* ------------------------------------------------------------------ *
 *  Timetable helpers shared by server + sample generator
 * ------------------------------------------------------------------ */

/**
 * Convert a 2-D array of rows into the timetable structure.
 * Expected layout: row 0 = [period label, day1, day2, ...]; every following
 * row = [period label, teacher1, teacher2, ...]. Empty cells = free period.
 */
function timetableFromRows(rows) {
  if (!rows || !rows.length) throw new Error('The file is empty.');
  const header = rows[0].map((s) => String(s == null ? '' : s).trim());
  const days = [];
  const dayIndex = [];
  header.slice(1).forEach((d) => {
    if (d && !days.includes(d)) {
      dayIndex.push(days.length);
      days.push(d);
    }
  });
  if (!days.length) throw new Error('No day columns found. Row 1 must list the days (e.g. Monday, Tuesday …).');
  const periods = [];
  const slots = {};
  days.forEach((d) => (slots[d] = {}));
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const period = String(r[0] == null ? '' : r[0]).trim();
    if (!period || periods.includes(period)) continue;
    periods.push(period);
    days.forEach((d, j) => {
      const cellIdx = dayIndex[j] + 1;
      slots[d][period] = String(r[cellIdx] == null ? '' : r[cellIdx]).trim();
    });
  }
  if (!periods.length) throw new Error('No period rows found. Column 1 must list the periods.');
  return { days, periods, slots };
}

/**
 * Parse an uploaded file (filename + buffer) into a timetable structure.
 * Supports .xlsx and .csv. Returns { days, periods, slots, source }.
 */
function parseTimetableFile(filename, data) {
  const lower = String(filename || '').toLowerCase();
  let rows;
  let source;
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    rows = readCsv(data.toString('utf8'));
    source = 'CSV';
  } else if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    try {
      rows = readXlsx(data).rows;
      source = 'Excel';
    } catch (err) {
      // Some files export a "Excel 97" style or are actually CSV with .xlsx name
      try {
        rows = readCsv(data.toString('utf8'));
        source = 'CSV (content)';
      } catch (err2) {
        throw new Error('Could not read the spreadsheet: ' + err.message);
      }
    }
  } else {
    // Unknown extension — try both
    try {
      rows = readXlsx(data).rows;
      source = 'Excel';
    } catch (e1) {
      try {
        rows = readCsv(data.toString('utf8'));
        source = 'CSV';
      } catch (e2) {
        throw new Error('Unsupported file type. Please upload an .xlsx or .csv file.');
      }
    }
  }
  const tt = timetableFromRows(rows);
  tt.source = source;
  return tt;
}

module.exports = {
  readXlsx,
  writeXlsx,
  readCsv,
  writeCsv,
  zip,
  timetableFromRows,
  parseTimetableFile,
};
