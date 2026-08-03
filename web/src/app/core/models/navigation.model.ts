import type { IconName } from '@shared/ui/icon/icon.registry';
import type { Permission, UserRole } from './auth.model';

export interface NavItem {
  readonly label: string;
  readonly route: string;
  readonly icon: IconName;
  /** Item is hidden unless the user holds at least one of these. Empty = always visible. */
  readonly permissions: readonly Permission[];
  readonly roles?: readonly UserRole[];
  readonly badge?: string;
}

export interface NavSection {
  readonly title: string | null;
  readonly items: readonly NavItem[];
}

export interface Breadcrumb {
  readonly label: string;
  readonly route: string | null;
}
