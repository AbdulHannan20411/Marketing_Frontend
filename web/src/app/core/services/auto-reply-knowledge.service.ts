import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

import { parseCsv } from '@core/files/csv';
import { buildWorkbook, readWorkbookRows, WorkbookReadError, type SheetSpec } from '@core/files/xlsx';
import {
  AVAILABLE_OPTIONS,
  KNOWLEDGE_COLUMNS,
  KNOWLEDGE_GUIDE_ROWS,
  KNOWLEDGE_KIND_COPY,
  KNOWLEDGE_KINDS,
  KNOWLEDGE_LIMITS,
  KNOWLEDGE_SHEET_NAME,
  KNOWLEDGE_TEMPLATE_EXAMPLES,
  KnowledgeFileError,
  knowledgeRow,
  parseKnowledgeRows,
  type AutoReplyKnowledge,
  type AutoReplyKnowledgeDraft,
  type KnowledgeEntry,
  type KnowledgeImport,
} from '@core/models/auto-reply-knowledge.model';
import { ApiService } from './api.service';
import { saveBlob } from './contacts.service';

const BASE = '/whatsapp/auto-reply/knowledge';

export const KNOWLEDGE_ACCEPT_ATTR =
  '.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv';

/**
 * The auto-reply assistant's knowledge: the fill-in template, reading a filled
 * one back, and saving the entries.
 *
 * Templates are built in the browser, so downloading one needs no round trip
 * and works before the API has the endpoint.
 */
@Injectable({ providedIn: 'root' })
export class AutoReplyKnowledgeService {
  private readonly api = inject(ApiService);

  get(): Observable<AutoReplyKnowledge> {
    return this.api.get<AutoReplyKnowledge>(BASE);
  }

  /** Replaces every entry. 422 is field-keyed by `entries[3].title` style paths. */
  save(draft: AutoReplyKnowledgeDraft): Observable<AutoReplyKnowledge> {
    return this.api.put<AutoReplyKnowledge, AutoReplyKnowledgeDraft>(BASE, draft);
  }

  clear(): Observable<null> {
    return this.api.delete(BASE);
  }

  downloadTemplate(): void {
    saveBlob(buildWorkbook(knowledgeSheets(KNOWLEDGE_TEMPLATE_EXAMPLES)), 'auto-reply-knowledge-template.xlsx');
  }

  /** The saved entries in the same template, ready to edit and upload again. */
  downloadCurrent(entries: readonly KnowledgeEntry[]): void {
    saveBlob(buildWorkbook(knowledgeSheets(entries)), 'auto-reply-knowledge.xlsx');
  }

  /**
   * Reads a filled-in template. Rejects the wrong kind of file with a message
   * worth showing as-is; row-level problems come back on the result instead.
   */
  async readFile(file: File): Promise<KnowledgeImport> {
    const name = file.name.toLowerCase();
    if (file.size === 0) {
      throw new KnowledgeFileError('That file is empty.');
    }
    if (file.size > KNOWLEDGE_LIMITS.fileBytes) {
      throw new KnowledgeFileError('That file is over 2 MB. The template is far smaller — is it the right file?');
    }
    if (name.endsWith('.xls')) {
      throw new KnowledgeFileError('Old .xls files are not supported. In Excel, choose File › Save As › Excel Workbook (.xlsx).');
    }

    let rows: string[][];
    if (name.endsWith('.xlsx')) {
      try {
        rows = await readWorkbookRows(new Uint8Array(await file.arrayBuffer()), KNOWLEDGE_SHEET_NAME);
      } catch (error) {
        throw new KnowledgeFileError(
          error instanceof WorkbookReadError ? error.message : 'That workbook could not be read. Try saving it again in Excel.',
        );
      }
    } else if (name.endsWith('.csv')) {
      rows = parseCsv(await file.text());
    } else {
      throw new KnowledgeFileError('Upload the template as .xlsx or .csv.');
    }

    return parseKnowledgeRows(rows);
  }
}

function knowledgeSheets(entries: readonly KnowledgeEntry[]): SheetSpec[] {
  const typeOptions = KNOWLEDGE_KINDS.map((kind) => KNOWLEDGE_KIND_COPY[kind].option);
  return [
    {
      name: KNOWLEDGE_SHEET_NAME,
      widths: [20, 42, 60, 16, 12, 34],
      rows: [[...KNOWLEDGE_COLUMNS], ...entries.map(knowledgeRow)],
      dropdowns: [
        {
          column: 0,
          options: typeOptions,
          prompt: 'Pick what this row is.',
          error: `Choose one of: ${typeOptions.join(', ')}.`,
        },
        {
          column: 4,
          options: AVAILABLE_OPTIONS,
          prompt: 'Products and services only. Leave empty if it does not apply.',
          error: 'Choose Yes or No.',
        },
      ],
      dropdownRows: KNOWLEDGE_LIMITS.maxEntries + 1,
    },
    { name: 'How to fill', widths: [20, 60, 42, 40], rows: KNOWLEDGE_GUIDE_ROWS },
  ];
}
