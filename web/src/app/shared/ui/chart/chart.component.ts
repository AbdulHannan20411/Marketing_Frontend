import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  input,
  type OnDestroy,
} from '@angular/core';
import ApexCharts, { type ApexOptions } from 'apexcharts';

/**
 * Thin ApexCharts host. Takes a full options object and keeps the instance in
 * sync with the signal, so callers compose charts from the presets in
 * `chart.presets.ts` without touching imperative chart APIs.
 */
@Component({
  selector: 'app-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: '',
})
export class ChartComponent implements OnDestroy {
  readonly options = input.required<ApexOptions>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private chart: ApexCharts | null = null;

  constructor() {
    effect(() => {
      const options = this.options();

      if (this.chart === null) {
        this.chart = new ApexCharts(this.host.nativeElement, options);
        void this.chart.render();
      } else {
        void this.chart.updateOptions(options, false, true);
      }
    });
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
    this.chart = null;
  }
}
