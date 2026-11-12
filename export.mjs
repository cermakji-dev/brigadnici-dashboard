// Export rozpisu přesně jako na obrazovce (a jako list v Google tabulce):
// dny pod sebou (15 řádků), barvy SMĚNY, VOLNÁ SMĚNA žlutě, prázdné růžově,
// počty a „Celkem hod.:“, vpravo souhrn hodin. Výstup: .xlsx (bez knihoven)
// a HTML pro vložení do Google tabulky se zachováním barev.

const COLORS = {
  smena1: "FFE599", smena2: "A9D18E", free: "FFFF00", none: "F4CCCC", fresh: "D6E4FF",
  count: "F3F3F3", over: "F4C7C3", border: "BFBFBF", blue: "1D3F8F"
};

// Mřížka listu: řádky buněk { v, s } + sloučené oblasti.
export const buildSheetGrid = model => {
  const rows = [];
  const merges = [];
  const set = (r, c, v, s) => {
    while (rows.length <= r) rows.push([]);
    rows[r][c] = { v, s };
  };
  model.days.forEach((day, index) => {
    const top = index * 15;
    const n = day.smena === 1 ? 1 : 2;
    set(top, 0, "", `date${n}`);
    set(top, 1, day.label, `date${n}`);
    for (let c = 2; c <= 8; c += 1) set(top, c, "", `date${n}`);
    merges.push({ r1: top, c1: 1, r2: top, c2: 8 });
    set(top, 9, `SMĚNA ${day.smena}`, `smena${n}`);
    for (let r = top + 1; r <= top + 13; r += 1) set(r, 9, "", `smena${n}`);
    merges.push({ r1: top, c1: 9, r2: top + 13, c2: 9 });
    set(top + 1, 0, "Určení:", `dept${n}`);
    for (let c = 0; c < 6; c += 1) set(top + 1, c + 1, day.columns[c] ? `↓ ${day.columns[c]} ↓` : "", `dept${n}`);
    set(top + 1, 7, "", `dept${n}`);
    set(top + 1, 8, "", `dept${n}`);
    merges.push({ r1: top + 1, c1: 7, r2: top + 1, c2: 8 });
    day.rows.slice(0, 12).forEach((row, offset) => {
      const r = top + 2 + offset;
      set(r, 0, row.label, "time");
      for (let c = 0; c < 6; c += 1) {
        const cell = row.cells[c] || { text: "", type: "none" };
        set(r, c + 1, cell.text || "", cell.type === "free" ? "free" : cell.type === "new" ? "new" : cell.type === "taken" ? "taken" : "none");
      }
      set(r, 7, row.label, "time");
      set(r, 8, row.count, "count");
    });
    set(top + 14, 7, "Celkem hod.:", "totalLabel");
    set(top + 14, 8, day.total, "totalValue");
  });
  // Souhrn vpravo (sloupce L–M) jako v listu.
  let r = 0;
  set(r, 11, "Jméno", "sumHead");
  set(r, 12, "Počet zapsaných hodin", "sumHead");
  model.people.forEach(person => {
    r += 1;
    const over = person.hours > 85;
    set(r, 11, person.name, over ? "sumOver" : "sumCell");
    set(r, 12, person.hours, over ? "sumOver" : "sumCell");
  });
  r += 2;
  [["Počet volných směn", model.stats.free], ["Počet obsazených směn", model.stats.taken], ["% obsazení", `${model.stats.percent}%`]].forEach(([label, value]) => {
    set(r, 11, label, "statLabel");
    set(r, 12, value, "statValue");
    r += 1;
  });
  r += 1;
  [["Plánované hodiny", model.stats.planned], ["Z toho LOG (obsazené)", model.stats.log]].forEach(([label, value]) => {
    set(r, 11, label, "green");
    set(r, 12, value, "greenValue");
    r += 1;
  });
  return { rows, merges, widths: [9, 20, 20, 20, 20, 20, 20, 9, 6, 5, 3, 24, 14] };
};

// --- XLSX -----------------------------------------------------------------

const STYLE_KEYS = ["default", "date1", "date2", "dept1", "dept2", "smena1", "smena2", "time", "free", "none", "taken", "new", "count",
  "totalLabel", "totalValue", "sumHead", "sumCell", "sumOver", "statLabel", "statValue", "green", "greenValue"];

const stylesXml = () => {
  const fills = ["none", "gray125", COLORS.smena1, COLORS.smena2, COLORS.free, COLORS.none, COLORS.fresh, COLORS.count, COLORS.over];
  const fillXml = fills.map((fill, index) => index < 2
    ? `<fill><patternFill patternType="${fill}"/></fill>`
    : `<fill><patternFill patternType="solid"><fgColor rgb="FF${fill}"/><bgColor indexed="64"/></patternFill></fill>`).join("");
  const fill = { smena1: 2, smena2: 3, free: 4, none: 5, fresh: 6, count: 7, over: 8 };
  // fontId: 0 běžné, 1 tučné, 2 tučné modré
  const xf = (fontId, fillId, borderId, align = "center", extra = "") =>
    `<xf numFmtId="0" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="${align}" vertical="center"${extra}/></xf>`;
  const map = {
    default: xf(0, 0, 0, "general"),
    date1: xf(1, fill.smena1, 1), date2: xf(1, fill.smena2, 1),
    dept1: xf(1, fill.smena1, 1), dept2: xf(1, fill.smena2, 1),
    smena1: xf(1, fill.smena1, 1, "center", ' textRotation="255" wrapText="1"'), smena2: xf(1, fill.smena2, 1, "center", ' textRotation="255" wrapText="1"'),
    time: xf(1, 0, 1), free: xf(0, fill.free, 1), none: xf(0, fill.none, 1), taken: xf(0, 0, 1), new: xf(2, fill.fresh, 1),
    count: xf(1, fill.count, 1), totalLabel: xf(1, 0, 0, "right"), totalValue: xf(1, fill.count, 1),
    sumHead: xf(1, 0, 1, "center", ' wrapText="1"'), sumCell: xf(0, 0, 1, "left"), sumOver: xf(0, fill.over, 1, "left"),
    statLabel: xf(1, 0, 1, "left"), statValue: xf(0, 0, 1), green: xf(1, fill.smena2, 1, "left"), greenValue: xf(1, fill.smena2, 1)
  };
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FF${COLORS.blue}"/><name val="Arial"/></font></fonts>
<fills count="${fills.length}">${fillXml}</fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FF${COLORS.border}"/></left><right style="thin"><color rgb="FF${COLORS.border}"/></right><top style="thin"><color rgb="FF${COLORS.border}"/></top><bottom style="thin"><color rgb="FF${COLORS.border}"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${STYLE_KEYS.length}">${STYLE_KEYS.map(key => map[key]).join("")}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
};

const columnName = index => {
  let name = "";
  let n = index + 1;
  while (n > 0) { const m = (n - 1) % 26; name = String.fromCharCode(65 + m) + name; n = Math.floor((n - 1) / 26); }
  return name;
};
const escapeXml = value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const sheetXml = grid => {
  const cols = grid.widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("");
  const rows = grid.rows.map((row, r) => {
    const cells = [];
    (row || []).forEach((cell, c) => {
      if (!cell) return;
      const ref = `${columnName(c)}${r + 1}`;
      const style = Math.max(0, STYLE_KEYS.indexOf(cell.s));
      if (typeof cell.v === "number") cells.push(`<c r="${ref}" s="${style}"><v>${cell.v}</v></c>`);
      else if (cell.v === "" || cell.v === null || cell.v === undefined) cells.push(`<c r="${ref}" s="${style}"/>`);
      else cells.push(`<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell.v)}</t></is></c>`);
    });
    return `<row r="${r + 1}" ht="16" customHeight="1">${cells.join("")}</row>`;
  }).join("");
  const merges = grid.merges.length
    ? `<mergeCells count="${grid.merges.length}">${grid.merges.map(m => `<mergeCell ref="${columnName(m.c1)}${m.r1 + 1}:${columnName(m.c2)}${m.r2 + 1}"/>`).join("")}</mergeCells>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0" zoomScale="100"/></sheetViews><cols>${cols}</cols><sheetData>${rows}</sheetData>${merges}
</worksheet>`;
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
const crc32 = bytes => {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

// Jednoduchý ZIP bez komprese (metoda „stored“) – stačí pro .xlsx.
export const zipFiles = files => {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  files.forEach(({ name, data }) => {
    const nameBytes = encoder.encode(name);
    const bytes = typeof data === "string" ? encoder.encode(data) : data;
    const crc = crc32(bytes);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint16(10, 0, true); local.setUint16(12, 0x21, true); local.setUint32(14, crc, true);
    local.setUint32(18, bytes.length, true); local.setUint32(22, bytes.length, true); local.setUint16(26, nameBytes.length, true); local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), nameBytes, bytes);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true); entry.setUint16(4, 20, true); entry.setUint16(6, 20, true); entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, 0, true); entry.setUint16(12, 0, true); entry.setUint16(14, 0x21, true); entry.setUint32(16, crc, true);
    entry.setUint32(20, bytes.length, true); entry.setUint32(24, bytes.length, true); entry.setUint16(28, nameBytes.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), nameBytes);
    offset += 30 + nameBytes.length + bytes.length;
  });
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
  const parts = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let position = 0;
  parts.forEach(part => { out.set(part, position); position += part.length; });
  return out;
};

export const buildXlsx = (model, sheetName = "Rozpis") => {
  const grid = buildSheetGrid(model);
  const safeName = escapeXml(String(sheetName).replace(/[\\/?*[\]:]/g, " ").slice(0, 31));
  return zipFiles([
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${safeName}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", data: stylesXml() },
    { name: "xl/worksheets/sheet1.xml", data: sheetXml(grid) }
  ]);
};

// --- HTML pro vložení do Google tabulky ------------------------------------

const CSS = {
  base: "border:1px solid #bfbfbf;font-family:Arial;font-size:10pt;text-align:center;vertical-align:middle;",
  date1: `background:#${COLORS.smena1};font-weight:bold;`, date2: `background:#${COLORS.smena2};font-weight:bold;`,
  dept1: `background:#${COLORS.smena1};font-weight:bold;`, dept2: `background:#${COLORS.smena2};font-weight:bold;`,
  smena1: `background:#${COLORS.smena1};font-weight:bold;`, smena2: `background:#${COLORS.smena2};font-weight:bold;`,
  time: "font-weight:bold;", free: `background:#${COLORS.free};`, none: `background:#${COLORS.none};`, taken: "",
  new: `background:#${COLORS.fresh};color:#${COLORS.blue};font-weight:bold;`, count: `background:#${COLORS.count};font-weight:bold;`,
  totalLabel: "border:none;text-align:right;font-weight:bold;", totalValue: `background:#${COLORS.count};font-weight:bold;`,
  sumHead: "font-weight:bold;", sumCell: "text-align:left;", sumOver: `background:#${COLORS.over};text-align:left;`,
  statLabel: "font-weight:bold;text-align:left;", statValue: "", green: `background:#${COLORS.smena2};font-weight:bold;text-align:left;`,
  greenValue: `background:#${COLORS.smena2};font-weight:bold;`, default: "border:none;"
};
const escapeHtml = value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const buildHtml = model => {
  const grid = buildSheetGrid(model);
  const width = Math.max(...grid.rows.map(row => row.length), 13);
  const covered = new Set();
  const spans = new Map();
  grid.merges.forEach(m => {
    spans.set(`${m.r1}|${m.c1}`, { rowspan: m.r2 - m.r1 + 1, colspan: m.c2 - m.c1 + 1 });
    for (let r = m.r1; r <= m.r2; r += 1) for (let c = m.c1; c <= m.c2; c += 1) if (r !== m.r1 || c !== m.c1) covered.add(`${r}|${c}`);
  });
  const body = grid.rows.map((row, r) => {
    const cells = [];
    for (let c = 0; c < width; c += 1) {
      if (covered.has(`${r}|${c}`)) continue;
      const cell = row?.[c];
      const span = spans.get(`${r}|${c}`);
      const attrs = span ? `${span.rowspan > 1 ? ` rowspan="${span.rowspan}"` : ""}${span.colspan > 1 ? ` colspan="${span.colspan}"` : ""}` : "";
      const style = cell ? CSS.base + (CSS[cell.s] || "") : "border:none;";
      cells.push(`<td${attrs} style="${style}">${cell ? escapeHtml(cell.v ?? "") : ""}</td>`);
    }
    return `<tr>${cells.join("")}</tr>`;
  }).join("");
  return `<table style="border-collapse:collapse">${body}</table>`;
};

// Obyčejný text (tabulátory) pro aplikace, které neumí HTML.
export const buildTsv = model => buildSheetGrid(model).rows
  .map(row => Array.from({ length: Math.max(row?.length || 0, 1) }, (_, c) => String(row?.[c]?.v ?? "")).join("\t")).join("\n");
