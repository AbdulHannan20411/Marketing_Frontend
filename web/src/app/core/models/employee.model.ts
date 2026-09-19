import type { UserRole } from './auth.model';
import type { Permission } from './permission.model';
import type { WhatsAppAccess } from './whatsapp-account.model';

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
  /**
   * Which WhatsApp numbers this person works on, and what they may do on each.
   * Admins are never listed here: they have full access to every number.
   * Optional while the API serves a single number.
   */
  readonly whatsAppAccess?: readonly WhatsAppAccess[];
  readonly defaultWhatsAppAccountId?: string | null;
}

/**
 * The public employee id (`emp_12`) for a user id.
 *
 * The session knows the signed-in user by the bare number from the token
 * (`12`); every employee screen — and conversation assignment — uses `emp_12`.
 * Comparing the two raw strings never matches, which is how "Assigned to you"
 * silently showed a name instead. `usr_` ids are accepted too.
 */
export function employeeIdOf(userId: string): string {
  if (/^\d+$/.test(userId)) {
    return `emp_${userId}`;
  }
  return userId.replace(/^usr_/, 'emp_');
}

/** Whether two ids name the same person, whichever prefix each carries. */
export function isSamePerson(left: string | null | undefined, right: string | null | undefined): boolean {
  if (left === null || left === undefined || right === null || right === undefined) {
    return false;
  }
  return employeeIdOf(left) === employeeIdOf(right);
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
