import type { IconName } from '@shared/ui/icon/icon.registry';
import type { UserRole } from './auth.model';
import type { FeatureModule, Permission } from './permission.model';

export interface NavItem {
  readonly label: string;
  readonly route: string;
  readonly icon: IconName;
  /** Item is hidden unless the user holds at least one of these. Empty = always visible. */
  readonly permissions: readonly Permission[];
  readonly roles?: readonly UserRole[];
  /** Item is hidden unless the current plan includes this module. */
  readonly module?: FeatureModule;
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
