export type ContactStatus = 'subscribed' | 'unsubscribed' | 'blocked';

export interface Contact {
  readonly id: string;
  readonly fullName: string;
  readonly initials: string;
  /** E.164, e.g. +447700900123. */
  readonly phoneNumber: string;
  readonly email: string | null;
  readonly country: string;
  readonly status: ContactStatus;
  readonly tagIds: readonly string[];
  readonly groupIds: readonly string[];
  readonly optedInAt: string | null;
  readonly lastMessagedAt: string | null;
  readonly createdAt: string;
}

export interface ContactGroup {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly contactCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type TagColor = 'brand' | 'info' | 'warning' | 'danger' | 'neutral';

export interface ContactTag {
  readonly id: string;
  readonly name: string;
  readonly color: TagColor;
  readonly contactCount: number;
  readonly createdAt: string;
}

export interface ContactQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly search: string;
  readonly status: ContactStatus | 'all';
  readonly groupId: string | 'all';
}
