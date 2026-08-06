import type { IconName } from '@shared/ui/icon/icon.registry';

export type SearchResultKind =
  | 'contact'
  | 'campaign'
  | 'template'
  | 'employee'
  | 'report'
  | 'subscription'
  | 'setting';

export interface SearchResult {
  readonly id: string;
  readonly kind: SearchResultKind;
  readonly title: string;
  readonly subtitle: string;
  readonly icon: IconName;
  readonly route: string;
}

export interface SearchResultGroup {
  readonly kind: SearchResultKind;
  readonly label: string;
  readonly results: readonly SearchResult[];
}
