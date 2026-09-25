import { Injectable, signal } from '@angular/core';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  readonly id: number;
  readonly tone: ToastTone;
  readonly title: string;
  readonly description: string | null;
  readonly durationMs: number;
  /** On its way out: kept in the list for one animation, then dropped. */
  readonly leaving: boolean;
}

const DEFAULT_DURATION_MS = 5000;

/** Long enough to see, short enough that nobody waits for it. Matches `animate-fall`. */
const LEAVE_MS = 180;

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly items = signal<readonly Toast[]>([]);
  private nextId = 0;

  readonly toasts = this.items.asReadonly();

  success(title: string, description: string | null = null): void {
    this.push('success', title, description);
  }

  error(title: string, description: string | null = null): void {
    this.push('error', title, description, 8000);
  }

  warning(title: string, description: string | null = null): void {
    this.push('warning', title, description);
  }

  info(title: string, description: string | null = null): void {
    this.push('info', title, description);
  }

  /**
   * Starts the exit animation, and removes the toast once it has played.
   *
   * Without the pause the element is simply gone: toasts appeared with an
   * animation and vanished without one, so a stack of them jumped as each one
   * disappeared. A second call while it is leaving is ignored — clicking the
   * close button twice must not remove the toast underneath.
   */
  dismiss(id: number): void {
    const toast = this.items().find((entry) => entry.id === id);
    if (toast === undefined || toast.leaving) {
      return;
    }

    this.items.update((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, leaving: true } : entry)),
    );
    setTimeout(() => this.remove(id), LEAVE_MS);
  }

  private remove(id: number): void {
    this.items.update((current) => current.filter((toast) => toast.id !== id));
  }

  private push(
    tone: ToastTone,
    title: string,
    description: string | null,
    durationMs = DEFAULT_DURATION_MS,
  ): void {
    const toast: Toast = {
      id: this.nextId++,
      tone,
      title,
      description,
      durationMs,
      leaving: false,
    };
    this.items.update((current) => [...current, toast]);
    setTimeout(() => this.dismiss(toast.id), durationMs);
  }
}
