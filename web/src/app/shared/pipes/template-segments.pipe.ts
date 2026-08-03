import { Pipe, type PipeTransform } from '@angular/core';

export interface TemplateSegment {
  readonly text: string;
  readonly isVariable: boolean;
}

const PLACEHOLDER = /(\{\{\s*\d+\s*\}\})/g;

/**
 * Splits WhatsApp template copy into plain and `{{1}}` placeholder segments so
 * the view can highlight variables without using innerHTML.
 */
@Pipe({ name: 'templateSegments' })
export class TemplateSegmentsPipe implements PipeTransform {
  transform(body: string, variableNames: readonly string[] = []): readonly TemplateSegment[] {
    return body
      .split(PLACEHOLDER)
      .filter((part) => part !== '')
      .map((part) => {
        const match = /\{\{\s*(\d+)\s*\}\}/.exec(part);
        if (match === null) {
          return { text: part, isVariable: false };
        }
        const index = Number(match[1]) - 1;
        return { text: variableNames[index] ?? part, isVariable: true };
      });
  }
}
