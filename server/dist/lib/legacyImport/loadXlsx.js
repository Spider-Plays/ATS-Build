import fs from 'fs';
import ExcelJS from 'exceljs';
function pad2(n) {
    return String(n).padStart(2, '0');
}
function formatDate(d) {
    const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
    const date = `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`;
    if (!hasTime)
        return date;
    return `${date} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function cellToString(value) {
    if (value == null || value === '')
        return '';
    if (typeof value === 'string')
        return value.trim();
    if (typeof value === 'number') {
        if (Number.isInteger(value) || Math.abs(value - Math.round(value)) < 1e-9) {
            return String(Math.round(value));
        }
        return String(value);
    }
    if (typeof value === 'boolean')
        return value ? 'Yes' : 'No';
    if (value instanceof Date)
        return formatDate(value);
    if (typeof value === 'object') {
        const rec = value;
        if (Array.isArray(rec.richText)) {
            return rec.richText
                .map((p) => p.text ?? '')
                .join('')
                .trim();
        }
        if (typeof rec.text === 'string')
            return rec.text.trim();
        if (typeof rec.hyperlink === 'string' && !rec.text)
            return String(rec.hyperlink).trim();
        if ('result' in rec)
            return cellToString(rec.result);
        if (typeof rec.error === 'string')
            return '';
    }
    return String(value).trim();
}
function rowFromCells(headers, values) {
    const row = {};
    headers.forEach((header, i) => {
        if (!header)
            return;
        const value = values[i] ?? '';
        if (!(header in row)) {
            row[header] = value;
            return;
        }
        let n = 2;
        let key = `${header}_dup${n}`;
        while (key in row) {
            n++;
            key = `${header}_dup${n}`;
        }
        row[key] = value;
    });
    return row;
}
function isEmptyRow(row) {
    return Object.values(row).every((v) => !String(v).trim());
}
/**
 * Read candidate rows from a SharePoint-style workbook (Main Data.xlsx).
 * Uses the first worksheet unless `sheetName` is set (Sheet2 is a QA fix list).
 */
export async function loadLegacyXlsx(xlsxPath, sheetName) {
    if (!fs.existsSync(xlsxPath)) {
        throw new Error(`Excel file not found: ${xlsxPath}`);
    }
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(xlsxPath);
    const ws = (sheetName ? workbook.getWorksheet(sheetName) : null) ??
        workbook.getWorksheet('Sheet1') ??
        workbook.worksheets[0];
    if (!ws) {
        throw new Error(`No worksheet found in ${xlsxPath}`);
    }
    const colCount = Math.max(ws.columnCount, ws.actualColumnCount || 0);
    const headerRow = ws.getRow(1);
    const headers = [];
    for (let i = 1; i <= colCount; i++) {
        headers.push(cellToString(headerRow.getCell(i).value));
    }
    if (!headers.some((h) => /resume\s*id/i.test(h) || /email/i.test(h) || /candidate name/i.test(h))) {
        throw new Error(`Sheet "${ws.name}" does not look like the candidate export (missing RESUME ID / Email / Name headers)`);
    }
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber === 1)
            return;
        const values = [];
        for (let i = 1; i <= colCount; i++) {
            values.push(cellToString(row.getCell(i).value));
        }
        const parsed = rowFromCells(headers, values);
        if (!isEmptyRow(parsed))
            rows.push(parsed);
    });
    console.log(`  Candidate Excel: ${xlsxPath} [${ws.name}] — ${rows.length} row(s)`);
    return rows;
}
