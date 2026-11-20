// Small Office files for tests and the end-to-end checks (tests/assistant-files.test.mjs, tools/files-e2e.mjs): a cafe
// opening's checklist workbook (filled in for one cafe: owners, dates, statuses, notes, the cafe's name and opening date;
// a title, headings, phases and tasks; formulas, fills, a date format, a merged title, a list to pick from), a Word
// document and a PowerPoint. Written with a zip writer of their own, nothing shared with the code they check.
import zlib from 'node:zlib';

/** A zip of { name: text } (deflated, or stored). */
export function zip(files, { store = false } = {}) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8');
    const packed = store ? data : zlib.deflateRawSync(data);
    const n = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(store ? 0 : 8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(store ? 0 : 8, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(packed.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    locals.push(local, n, packed);
    central.push(c, n);
    offset += 30 + n.length + packed.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

export const X = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
export const CT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const s = (i) => `t="s"><v>${i}</v>`;
export const STRINGS = ['Cafe Opening Checklist', 'Venue:', 'Wexley St', 'Opening date:', 'Phase', 'Task', 'Owner', 'Due', 'Status', 'Notes', 'Days to go', 'Before opening', 'Order signage', 'Sam', 'Done', 'Book the fit-out crew', 'Priya', 'In progress', 'Landlord wants keys back by 5pm', 'Set up the card reader', 'Opening week', 'Staff rostered', 'Total done', 'Statuses', 'Not started'];
export const SST = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${STRINGS.length}" uniqueCount="${STRINGS.length}">${STRINGS.map((t) => `<si><t>${t}</t></si>`).join('')}</sst>`;
export const ix = (t) => STRINGS.indexOf(t);
// Styles: 0 plain · 1 bold · 2 a date (d/mm/yyyy) · 3 a filled cell (an input) · 4 a filled date.
export const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="d/mm/yyyy"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="14" fontId="0" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/></cellXfs></styleSheet>`;
export const COLS = '<cols><col min="1" max="1" width="16" customWidth="1"/><col min="2" max="2" width="34" customWidth="1"/></cols>';
export const MERGE = '<mergeCells count="1"><mergeCell ref="A1:G1"/></mergeCells>';
export const VALID = '<dataValidations count="1"><dataValidation type="list" allowBlank="1" sqref="E6:E9"><formula1>Lists!$A$2:$A$4</formula1></dataValidation></dataValidations>';
export const TASKS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet ${X}><dimension ref="A1:G10"/><sheetViews><sheetView workbookViewId="0"/></sheetViews>${COLS}<sheetData>` +
  `<row r="1"><c r="A1" s="1" ${s(ix('Cafe Opening Checklist'))}</c></row>` +
  `<row r="2"><c r="A2" ${s(ix('Venue:'))}</c><c r="B2" s="3" ${s(ix('Wexley St'))}</c></row>` +
  `<row r="3"><c r="A3" ${s(ix('Opening date:'))}</c><c r="B3" s="4"><v>46330</v></c></row>` +
  `<row r="5" spans="1:7">${['Phase', 'Task', 'Owner', 'Due', 'Status', 'Notes', 'Days to go'].map((h, i) => `<c r="${'ABCDEFG'[i]}5" s="1" ${s(ix(h))}</c>`).join('')}</row>` +
  `<row r="6" spans="1:7"><c r="A6" ${s(ix('Before opening'))}</c><c r="B6" ${s(ix('Order signage'))}</c><c r="C6" s="3" ${s(ix('Sam'))}</c><c r="D6" s="4"><v>46300</v></c><c r="E6" s="3" ${s(ix('Done'))}</c><c r="F6" s="3"/><c r="G6"><f t="shared" ref="G6:G9" si="0">D6-$B$3</f><v>-30</v></c></row>` +
  `<row r="7" spans="1:7"><c r="A7" ${s(ix('Before opening'))}</c><c r="B7" ${s(ix('Book the fit-out crew'))}</c><c r="C7" s="3" ${s(ix('Priya'))}</c><c r="D7" s="4"><v>46310</v></c><c r="E7" s="3" ${s(ix('In progress'))}</c><c r="F7" s="3" ${s(ix('Landlord wants keys back by 5pm'))}</c><c r="G7"><f t="shared" si="0"/><v>-20</v></c></row>` +
  `<row r="8" spans="1:7"><c r="A8" ${s(ix('Opening week'))}</c><c r="B8" ${s(ix('Set up the card reader'))}</c><c r="C8" s="3" ${s(ix('Sam'))}</c><c r="D8" s="4"><v>46325</v></c><c r="E8" s="3" ${s(ix('Done'))}</c><c r="G8"><f t="shared" si="0"/><v>-5</v></c></row>` +
  `<row r="9" spans="1:7"><c r="A9" ${s(ix('Opening week'))}</c><c r="B9" ${s(ix('Staff rostered'))}</c><c r="C9" s="3"/><c r="D9" s="4"/><c r="E9" s="3"/><c r="G9"><f t="shared" si="0"/><v>-46330</v></c></row>` +
  `<row r="10"><c r="A10" s="1" ${s(ix('Total done'))}</c><c r="E10" s="1"><f>COUNTIF(E6:E9,"Done")</f><v>2</v></c></row>` +
  `</sheetData>${MERGE}${VALID}<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;
export const LISTS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet ${X}><sheetData><row r="1"><c r="A1" s="1" ${s(ix('Statuses'))}</c></row><row r="2"><c r="A2" ${s(ix('Not started'))}</c></row><row r="3"><c r="A3" ${s(ix('In progress'))}</c></row><row r="4"><c r="A4" ${s(ix('Done'))}</c></row></sheetData></worksheet>`;
export const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook ${X}><bookViews><workbookView/></bookViews><sheets><sheet name="Tasks" sheetId="1" r:id="rId1"/><sheet name="Lists" sheetId="2" r:id="rId2"/></sheets><definedNames><definedName name="Statuses">Lists!$A$2:$A$4</definedName></definedNames><calcPr calcId="191029"/></workbook>`;
export const WB_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${CT}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${CT}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="${CT}/styles" Target="styles.xml"/><Relationship Id="rId4" Type="${CT}/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId5" Type="${CT}/calcChain" Target="calcChain.xml"/></Relationships>`;
export const TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/></Types>`;
export const CHAIN = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><c r="G6" i="1"/><c r="G7"/><c r="G8"/><c r="G9"/><c r="E10"/></calcChain>';
export const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${CT}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
export const CHECKLIST_PARTS = {
  '[Content_Types].xml': TYPES,
  '_rels/.rels': ROOT_RELS,
  'xl/workbook.xml': WORKBOOK,
  'xl/_rels/workbook.xml.rels': WB_RELS,
  'xl/styles.xml': STYLES,
  'xl/sharedStrings.xml': SST,
  'xl/worksheets/sheet1.xml': TASKS,
  'xl/worksheets/sheet2.xml': LISTS,
  'xl/calcChain.xml': CHAIN,
};
export const checklist = () => zip(CHECKLIST_PARTS);

export const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
export const DOCX = () =>
  zip({
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    'word/document.xml': `<w:document ${W}><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Wexley</w:t></w:r><w:r><w:t xml:space="preserve"> St cafe</w:t></w:r></w:p><w:p><w:r><w:t>Opening: Wexley</w:t></w:r></w:p><w:p><w:r><w:t>St is separate &amp; kept</w:t></w:r></w:p></w:body></w:document>`,
    'word/footer1.xml': `<w:ftr ${W}><w:p><w:r><w:t>Wexley St · confidential</w:t></w:r></w:p></w:ftr>`,
  });
export const PPTX = () =>
  zip({
    'ppt/slides/slide1.xml': '<p:sld xmlns:p="p" xmlns:a="a"><p:txBody><a:p><a:r><a:rPr sz="4000"/><a:t>Wexley St</a:t></a:r><a:r><a:t> opening</a:t></a:r></a:p></p:txBody></p:sld>',
    'ppt/slides/slide2.xml': '<p:sld xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>No match here</a:t></a:r></a:p></p:sld>',
  });


/**
 * A cafe opening's checklist as people really keep one: many sheets (an overview with the cafe's fields and totals, a
 * sheet per phase with 20–40 tasks each, contacts, lists), a title above each sheet's headings, formulas down a column and
 * across sheets. `venue` filled in (owners, dates, statuses, notes, the cafe's name, manager and opening date) is the
 * project's working copy; without, the blank master. Cells written as inline words (no shared-strings part).
 */
export function bigChecklist({ venue = '', manager = 'Ana Ruiz' } = {}) {
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const cell = (ref, v, style) => {
    const st = style !== undefined ? ` s="${style}"` : '';
    if (v === null || v === undefined || v === '') return style !== undefined ? `<c r="${ref}"${st}/>` : '';
    if (typeof v === 'number') return `<c r="${ref}"${st}><v>${v}</v></c>`;
    if (String(v).startsWith('=')) return `<c r="${ref}"${st}><f>${esc(String(v).slice(1))}</f></c>`;
    return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  };
  const sheetXml = (rows, extra = '') => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet ${X}><sheetData>${rows.map(([r, cells]) => `<row r="${r}">${cells.join('')}</row>`).join('')}</sheetData>${extra}</worksheet>`;
  const people = ['Sam Taylor', 'Priya Shah', 'Tom Ngata', 'Lee Wong', manager];
  const statuses = ['Done', 'Done', 'In progress', 'Not started', 'Blocked'];
  const opening = 46330;
  const phases = {
    'Before opening': ['Sign the lease', 'Order signage', 'Book the fit-out crew', 'Council consent', 'Food licence', 'Insurance in place', 'Utilities connected', 'Waste collection booked', 'Cleaning contract', 'Flour supplier chosen'],
    Kitchen: ['Strip out', 'Electrical first fix', 'Plumbing', 'Flooring', 'Benches and shelving', 'Paint', 'Lighting', 'Extraction hood', 'Cool room', 'Final clean'],
    'Equipment & supplies': ['Oven commissioned', 'Coffee machine serviced', 'Card reader', 'Mixer and proofer', 'Fridges and freezers', 'Dishwasher', 'Scales checked', 'Menu boards', 'Cups and boxes ordered', 'Wi-Fi for customers'],
    Staff: ['Advertise roles', 'Interviews', 'Offers sent', 'Contracts signed', 'Induction day', 'Rosters for week one', 'Aprons ordered', 'Keys and alarm codes', 'Coffee training', 'First-aid officer'],
    'Getting the word out': ['Opening date announced', 'Social posts planned', 'Local paper', 'Flyers', 'Opening offer', 'Window display', 'Google listing', 'Photos of the bakes', 'Invite the neighbours', 'Opening-day tasting'],
    'Opening week': ['First flour delivery', 'Counter display', 'Change for the cash drawer', 'Soft opening', 'Opening day', 'Daily huddles', 'Feedback cards', 'First week’s takings', 'Snag list', 'Thank the builder'],
  };
  const files = {};
  const sheetNames = ['Overview', ...Object.keys(phases), 'Contacts', 'Lists'];
  // Overview: the cafe's fields, then a line per phase with its totals across the sheets.
  const ov = [
    [1, [cell('A1', 'Cafe Opening Checklist — Our Bakery Cafe', 1)]],
    [3, [cell('A3', 'Venue:'), cell('B3', venue, 3)]],
    [4, [cell('A4', 'Opening date:'), cell('B4', venue ? opening : '', 4)]],
    [5, [cell('A5', 'Cafe manager:'), cell('B5', venue ? manager : '', 3)]],
    [6, [cell('A6', 'Prepared by:'), cell('B6', venue ? 'Sam Taylor' : '', 3)]],
    [8, ['Phase', 'Tasks', 'Done', '% complete'].map((h, i) => cell(`${'ABCD'[i]}8`, h, 1))],
  ];
  Object.keys(phases).forEach((p, i) => {
    const r = 9 + i;
    const q = `'${p}'`;
    ov.push([r, [cell(`A${r}`, p), cell(`B${r}`, `=COUNTA(${q}!B4:B60)`), cell(`C${r}`, `=COUNTIF(${q}!E4:E60,"Done")`), cell(`D${r}`, `=IF(B${r}=0,0,C${r}/B${r})`)]]);
  });
  files.Overview = sheetXml(ov, '<mergeCells count="1"><mergeCell ref="A1:D1"/></mergeCells>');
  // A sheet per phase: a title, the headings in row 3, its tasks (each phase's list three times over, as stages).
  Object.entries(phases).forEach(([p, tasks], pi) => {
    const rows = [
      [1, [cell('A1', `${p} — tasks`, 1)]],
      [3, ['Ref', 'Task', 'Owner', 'Due', 'Status', 'Notes', 'Days before opening', 'Days to go'].map((h, i) => cell(`${'ABCDEFGH'[i]}3`, h, 1))],
    ];
    const all = [...tasks, ...tasks.map((t) => `${t}: check`), ...tasks.slice(0, 5 + pi).map((t) => `${t}: sign off`)];
    all.forEach((t, k) => {
      const r = 4 + k;
      const before = 90 - pi * 12 - k;
      const filled = venue && k % 7 !== 6;
      rows.push([
        r,
        [
          cell(`A${r}`, `${pi + 1}.${k + 1}`),
          cell(`B${r}`, t),
          cell(`C${r}`, filled ? people[(k + pi) % people.length] : '', 3),
          cell(`D${r}`, filled ? opening - before : '', 4),
          cell(`E${r}`, filled ? statuses[(k + pi) % statuses.length] : '', 3),
          cell(`F${r}`, filled && k % 4 === 0 ? `Followed up with ${people[k % people.length]} on ${t.toLowerCase()}` : '', 3),
          cell(`G${r}`, before),
          cell(`H${r}`, `=IF(D${r}="","",D${r}-Overview!$B$4)`),
        ],
      ]);
    });
    files[p] = sheetXml(rows, '<dataValidations count="1"><dataValidation type="list" allowBlank="1" sqref="E4:E60"><formula1>Lists!$A$2:$A$5</formula1></dataValidation></dataValidations>');
  });
  files.Contacts = sheetXml([
    [1, ['Role', 'Name', 'Phone', 'Email'].map((h, i) => cell(`${'ABCD'[i]}1`, h, 1))],
    ...['Head baker', 'Landlord', 'Builder', 'Card reader support', 'Signwriter'].map((role, k) => [k + 2, [cell(`A${k + 2}`, role), cell(`B${k + 2}`, venue ? people[k] : '', 3), cell(`C${k + 2}`, venue ? `021 555 01${k}` : '', 3), cell(`D${k + 2}`, venue ? `${people[k].split(' ')[0].toLowerCase()}@example.com` : '', 3)]]),
  ]);
  files.Lists = sheetXml([[1, [cell('A1', 'Statuses', 1)]], ...['Not started', 'In progress', 'Blocked', 'Done'].map((v, k) => [k + 2, [cell(`A${k + 2}`, v)]])]);
  const parts = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheetNames.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    '_rels/.rels': ROOT_RELS,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook ${X}><sheets>${sheetNames.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029"/></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetNames.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${CT}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheetNames.length + 1}" Type="${CT}/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': STYLES,
  };
  sheetNames.forEach((n, i) => (parts[`xl/worksheets/sheet${i + 1}.xml`] = files[n]));
  return zip(parts);
}
