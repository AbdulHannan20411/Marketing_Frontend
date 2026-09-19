import { parseCsv } from './csv';
import { buildWorkbook, columnIndex, columnLetter, readWorkbookRows } from './xlsx';
import { createZip, readZip } from './zip';

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe('csv', () => {
  it('reads quotes, doubled quotes, line breaks in quotes, CRLF and a BOM', () => {
    const text = '﻿Type,Answer\r\nFAQ,"Yes, we ""do"" deliver\nacross Lahore"\r\nRule,\r\n';
    expect(parseCsv(text)).toEqual([
      ['Type', 'Answer'],
      ['FAQ', 'Yes, we "do" deliver\nacross Lahore'],
      ['Rule', ''],
    ]);
  });

  it('uses semicolons when Excel saved with them', () => {
    expect(parseCsv('Type;Price\nProduct;Rs 1,500')).toEqual([
      ['Type', 'Price'],
      ['Product', 'Rs 1,500'],
    ]);
  });
});

describe('xlsx', () => {
  it('maps column letters both ways', () => {
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(25)).toBe('Z');
    expect(columnLetter(26)).toBe('AA');
    expect(columnIndex('AA')).toBe(26);
    expect(columnIndex('f')).toBe(5);
  });

  it('reads back what it writes, including gaps, symbols and Urdu', async () => {
    const blob = buildWorkbook([
      { name: 'Guide', widths: [10], rows: [['Ignore me']] },
      {
        name: 'Knowledge',
        widths: [10, 10, 10],
        rows: [
          ['Type', 'Question or name', 'Answer or details'],
          ['FAQ', 'Price < 5 & "cheap"?', 'قیمت'],
          ['Rule', '', 'Only C filled'],
        ],
        dropdowns: [{ column: 0, options: ['FAQ', 'Rule'], prompt: 'Pick', error: 'No' }],
      },
    ]);

    const rows = await readWorkbookRows(await bytesOf(blob), 'knowledge');
    expect(rows).toEqual([
      ['Type', 'Question or name', 'Answer or details'],
      ['FAQ', 'Price < 5 & "cheap"?', 'قیمت'],
      ['Rule', '', 'Only C filled'],
    ]);
  });

  it('writes the dropdown as a list validation', async () => {
    const blob = buildWorkbook([
      {
        name: 'Knowledge',
        widths: [10],
        rows: [['Type']],
        dropdowns: [{ column: 0, options: ['FAQ', 'Rule'], prompt: 'Pick', error: 'No' }],
        dropdownRows: 50,
      },
    ]);
    const sheet = await readZip(await bytesOf(blob)).read('xl/worksheets/sheet1.xml');
    const xml = new TextDecoder().decode(sheet ?? new Uint8Array());
    expect(xml).toContain('type="list"');
    expect(xml).toContain('sqref="A2:A50"');
    expect(xml).toContain('<formula1>&quot;FAQ,Rule&quot;</formula1>');
  });

  it('reads deflated entries and shared strings, as Excel saves them', async () => {
    const encode = (text: string) => new TextEncoder().encode(text);
    const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const files = {
      'xl/workbook.xml': `<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="Knowledge" sheetId="1" r:id="rId7"/></sheets></workbook>`,
      'xl/_rels/workbook.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Type="${rel}/worksheet" Target="/xl/worksheets/data.xml"/></Relationships>`,
      'xl/sharedStrings.xml': `<sst xmlns="${ns}"><si><t>Type</t></si><si><r><t>Pro</t></r><r><t>duct</t></r></si></sst>`,
      'xl/worksheets/data.xml': `<worksheet xmlns="${ns}"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="3"><c r="A3" t="s"><v>1</v></c><c r="C3"><v>1500</v></c></row></sheetData></worksheet>`,
    };
    const entries = await Promise.all(
      Object.entries(files).map(async ([name, xml]) => ({ name, data: await deflate(encode(xml)) })),
    );
    // Stored-size archive, then patch each entry to method 8 (deflate).
    const zip = createZip(entries);
    const view = new DataView(zip.buffer);
    for (let i = 0; i < zip.length - 4; i++) {
      const signature = view.getUint32(i, true);
      if (signature === 0x04034b50) {
        view.setUint16(i + 8, 8, true);
      } else if (signature === 0x02014b50) {
        view.setUint16(i + 10, 8, true);
      }
    }

    const rows = await readWorkbookRows(zip, 'Knowledge');
    expect(rows).toEqual([['Type'], [], ['Product', '', '1500']]);
  });

  it('refuses a file that is not a workbook', async () => {
    await expectAsync(readWorkbookRows(new TextEncoder().encode('Type,Answer'), 'Knowledge')).toBeRejectedWithError(
      /not an Excel workbook/,
    );
  });
});
