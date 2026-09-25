import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

import { IconComponent } from '@shared/ui/icon/icon.component';
import type { IconName } from '@shared/ui/icon/icon.registry';

let nextId = 0;

/**
 * A card whose body opens and closes from its own heading.
 *
 * Settings was a single column of long, fully expanded cards, so finding one
 * setting meant scrolling past every other. This is the same pattern the Help
 * &amp; FAQ list already used on that page, lifted out so every section reads
 * the same way: the whole heading is the control, the chevron says which way
 * it will go, and the body is only in the DOM while it is open.
 *
 * The open state can be left to the component or driven from outside with
 * `[(open)]` — for a section that something else needs to expand, such as a
 * deep link.
 */
@Component({
  selector: 'app-accordion-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'block' },
  template: `
    <div class="overflow-hidden rounded-xl bg-surface ring-1 ring-line shadow-card">
      <h2>
        <button
          type="button"
          class="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none focus-visible:ring-inset"
          [attr.aria-expanded]="open()"
          [attr.aria-controls]="panelId"
          (click)="toggle()"
        >
          @if (icon() !== null) {
            <span
              class="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
              [class]="tone() === 'danger' ? 'bg-red-50 text-danger' : 'bg-brand-50 text-brand-700'"
            >
              <app-icon [name]="icon()!" [size]="18" />
            </span>
          }

          <span class="min-w-0 flex-1">
            <span
              class="block text-sm font-semibold"
              [class]="tone() === 'danger' ? 'text-danger' : 'text-ink'"
            >
              {{ title() }}
            </span>
            @if (subtitle() !== null) {
              <span class="mt-0.5 block text-xs leading-relaxed text-ink-muted">
                {{ subtitle() }}
              </span>
            }
          </span>

          <!-- A count, a badge, whatever the section wants to say while shut. -->
          <ng-content select="[sectionMeta]" />

          <app-icon
            name="chevronDown"
            [size]="18"
            class="shrink-0 text-ink-muted transition-transform duration-200"
            [class.rotate-180]="open()"
          />
        </button>
      </h2>

      @if (open()) {
        <div [id]="panelId" class="animate-fade-in border-t border-line px-5 pt-4 pb-5">
          <ng-content />
        </div>
      }
    </div>
  `,
})
export class AccordionSectionComponent {
  readonly title = input.required<string>();
  readonly subtitle = input<string | null>(null);
  readonly icon = input<IconName | null>(null);
  /** `danger` tints the heading, for a section that destroys something. */
  readonly tone = input<'default' | 'danger'>('default');
  readonly open = model(false);

  protected readonly panelId = `accordion-panel-${nextId++}`;

  protected toggle(): void {
    this.open.update((open) => !open);
  }
}
