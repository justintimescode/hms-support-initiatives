// XLSX ingest tests for the two column-mapping defects found by driving the app
// against a real ServiceNow export.
//
//  1. DUPLICATE HEADERS. The standard case export ships the header "Number"
//     TWICE — column 1 is the case number (CS1887438), a later column is the
//     account number (ACCT9000004). `readXlsxRows` assigned unconditionally, so
//     the LAST occurrence won and every row's `number` became an account number.
//     Case numbers were then wrong everywhere they are displayed, copied or
//     exported; non-unique React keys produced "two children with the same key";
//     and the SN<->Jira correlation would collapse every case sharing an account
//     into ONE node, silently undercounting blast radius.
//
//  2. UNMAPPED COLUMNS. `Region` and `Assignment group` are both present in that
//     same export and were simply never mapped, so the app behaved as though the
//     columns did not exist.
//
// Runs under `node --test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';

import { readXlsxRows } from './useAppData.js';
import { normalizeXlsxRow } from './enrich.js';

/** Build an in-memory .xlsx and return its ArrayBuffer. */
async function sheet(headers, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Page 1');
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
  const buf = await wb.xlsx.writeBuffer();
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/* ===================== duplicate headers: first wins ==================== */

test('a repeated header keeps the FIRST column, not the last', async () => {
  // Exactly the real layout: "Number" at column 1 (case) and again later
  // (account), with other columns in between.
  const buf = await sheet(
    ['Number', 'Account', 'Short Description', 'Region', 'Number', 'Softrax ID'],
    [
      ['CS1887438', 'Acme Resorts', 'folio wrong', 'NA', 'ACCT9000004', 'SFX-1'],
      ['CS1887419', 'Beta Hotels', 'audit hangs', 'EMEA', 'ACCT0015322', 'SFX-2'],
    ],
  );
  const rows = await readXlsxRows(buf);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].Number, 'CS1887438', 'the case number must win, not the account number');
  assert.notEqual(rows[0].Number, 'ACCT9000004');
  assert.equal(rows[1].Number, 'CS1887419');
  // The other columns are unaffected.
  assert.equal(rows[0].Account, 'Acme Resorts');
  assert.equal(rows[0]['Softrax ID'], 'SFX-1');
});

test('case numbers stay UNIQUE across rows sharing an account (the React-key bug)', async () => {
  const buf = await sheet(
    ['Number', 'Account', 'Number'],
    [
      ['CS0000001', 'Acme', 'ACCT9000004'],
      ['CS0000002', 'Acme', 'ACCT9000004'], // same account, different case
      ['CS0000003', 'Acme', 'ACCT9000004'],
    ],
  );
  const numbers = (await readXlsxRows(buf)).map((r) => normalizeXlsxRow(r).number);
  assert.deepEqual(numbers, ['CS0000001', 'CS0000002', 'CS0000003']);
  assert.equal(new Set(numbers).size, 3, 'three cases must remain three distinct identities');
});

test('a sheet with no repeated header is unaffected', async () => {
  const buf = await sheet(['Number', 'Account'], [['CS1', 'Acme']]);
  const rows = await readXlsxRows(buf);
  assert.equal(rows[0].Number, 'CS1');
  assert.equal(rows[0].Account, 'Acme');
});

test('a blank first occurrence still wins — the rule is positional, not truthiness', async () => {
  // Deliberate: "prefer the non-empty one" would be data-dependent and could
  // silently pick different columns for different rows of the same file.
  const buf = await sheet(['Number', 'Number'], [[null, 'ACCT1'], ['CS2', 'ACCT2']]);
  const rows = await readXlsxRows(buf);
  // The first column claims the key and reports its own blank value as null. It
  // does NOT fall through to the account number in the second column: preferring
  // "whichever is non-empty" would let different ROWS of one file resolve to
  // different columns, which is a worse failure than a visible null.
  assert.equal(rows[0].Number, null, 'row 1 column 1 was blank, so Number is null');
  assert.notEqual(rows[0].Number, 'ACCT1');
  assert.equal(rows[1].Number, 'CS2');
});

/* ======================== newly mapped columns ========================== */

test('normalizeXlsxRow maps Region and Assignment group', () => {
  const mapped = normalizeXlsxRow({
    Number: 'CS1',
    Region: 'NA',
    'Assignment group': 'Hospitality - HMS Support',
  });
  assert.equal(mapped.region, 'NA');
  assert.equal(mapped.assignment_group, 'Hospitality - HMS Support');
});

test('the Assignment group label is matched case-insensitively on the second word', () => {
  assert.equal(normalizeXlsxRow({ 'Assignment Group': 'Hospitality - HMS Support' }).assignment_group,
    'Hospitality - HMS Support');
});

test('both are null when the export omits them — never an invented value', () => {
  const mapped = normalizeXlsxRow({ Number: 'CS1' });
  assert.equal(mapped.region, null);
  assert.equal(mapped.assignment_group, null);
});

test('the new mappings did not disturb the existing ones', () => {
  const mapped = normalizeXlsxRow({
    Number: 'CS1', Account: 'Acme', 'Parent Account': 'Armed Forces - Navy (HQ)',
    Priority: '2 - Major', State: 'Open', 'Product line': 'HMS', 'Assigned to': 'Ana',
    Manager: 'Mgr One', Tags: 'Kiro Assisted', Region: 'NA',
    'Assignment group': 'Hospitality - HMS Support',
  });
  assert.equal(mapped.number, 'CS1');
  assert.equal(mapped.account, 'Acme');
  assert.equal(mapped.parent_account, 'Armed Forces - Navy (HQ)');
  assert.equal(mapped.priority, '2 - Major');
  assert.equal(mapped.product_line, 'HMS');
  assert.equal(mapped.assigned_to, 'Ana');
  assert.equal(mapped.manager, 'Mgr One');
  assert.equal(mapped.tags, 'Kiro Assisted');
});
