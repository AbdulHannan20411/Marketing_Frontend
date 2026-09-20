import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  input,
  signal,
  type OnDestroy,
} from '@angular/core';
import type ApexCharts from 'apexcharts';
import type { ApexOptions } from 'apexcharts';

/**
 * Thin ApexCharts host. Takes a full options object and keeps the instance in
 * sync with the signal, so callers compose charts from the presets in
 * `chart.presets.ts` without touching imperative chart APIs.
 *
 * **ApexCharts is loaded on demand.** It is 560 KB — larger than the whole
 * application shell — and importing it at the top would put it on the critical
 * path of every page that carries a chart, including the dashboard that opens
 * after sign-in. The page renders its layout and figures first; the library
 * arrives, then the chart draws itself into the space already reserved for it.
 */
@Component({
  selector: 'app-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (!ready()) {
      <div class="h-full w-full animate-pulse rounded-lg bg-surface-sunken" aria-hidden="true"></div>
    }
  `,
})
export class ChartComponent implements OnDestroy {
  readonly options = input.required<ApexOptions>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private chart: ApexCharts | null = null;
  /** Swaps the placeholder for the chart once the library has drawn it. */
  protected readonly ready = signal(false);
  /** Set when the component is torn down mid-load, so a late arrival stops. */
  private destroyed = false;
  private loading: Promise<typeof ApexCharts> | null = null;

  constructor() {
    effect(() => {
      const options = this.options();

      if (this.chart !== null) {
        void this.chart.updateOptions(options, false, true);
        return;
      }
      void this.draw(options);
    });
  }

  private async draw(options: ApexOptions): Promise<void> {
    // One load per component, even if options change while it is in flight.
    this.loading ??= import('apexcharts').then((module) => module.default);
    const Apex = await this.loading;

    if (this.destroyed || this.chart !== null) {
      return;
    }
    // The newest options win: the effect may have run again while loading.
    this.chart = new Apex(this.host.nativeElement, this.options() ?? options);
    await this.chart.render();
    this.ready.set(true);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.chart?.destroy();
    this.chart = null;
  }
}
