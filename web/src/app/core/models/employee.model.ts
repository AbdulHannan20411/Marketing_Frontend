import type { UserRole } from './auth.model';
import type { Permission } from './permission.model';

export type EmployeeStatus = 'active' | 'invited' | 'suspended';

export interface Employee {
  readonly id: string;
  readonly name: string;
  readonly initials: string;
  readonly email: string;
  readonly jobTitle: string;
  readonly role: UserRole;
  readonly status: EmployeeStatus;
  readonly permissions: readonly Permission[];
  readonly lastActiveAt: string | null;
  readonly invitedAt: string;
}

/** A reusable named permission set an Admin can apply to employees. */
export interface PermissionSet {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly isSystem: boolean;
  readonly permissions: readonly Permission[];
  readonly assignedCount: number;
}
