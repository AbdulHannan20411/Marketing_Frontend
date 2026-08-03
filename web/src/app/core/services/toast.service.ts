import { Injectable, signal } from '@angular/core';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  readonly id: number;
  readonly tone: ToastTone;
  readonly title: string;
  readonly description: string | null;
  readonly durationMs: number;
}

const DEFAULT_DURATION_MS = 5000;

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

  dismiss(id: number): void {
    this.items.update((current) => current.filter((toast) => toast.id !== id));
  }

  private push(
    tone: ToastTone,
    title: string,
    description: string | null,
    durationMs = DEFAULT_DURATION_MS,
  ): void {
    const toast: Toast = { id: this.nextId++, tone, title, description, durationMs };
    this.items.update((current) => [...current, toast]);
    setTimeout(() => this.dismiss(toast.id), durationMs);
  }
}
