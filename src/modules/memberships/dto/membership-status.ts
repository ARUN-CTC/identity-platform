/** INVITED -> ACTIVE <-> SUSPENDED -> REMOVED. Assigned only by the invitation-accept flow, never chosen directly by an admin call. */
export type MembershipStatus = 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'REMOVED';

export const MEMBERSHIP_STATUSES: MembershipStatus[] = ['INVITED', 'ACTIVE', 'SUSPENDED', 'REMOVED'];

/** Statuses an admin may transition a membership to directly via the members API — INVITED is set only by the invitation flow itself. */
export type AdminSettableMembershipStatus = 'ACTIVE' | 'SUSPENDED' | 'REMOVED';
export const ADMIN_SETTABLE_MEMBERSHIP_STATUSES: AdminSettableMembershipStatus[] = ['ACTIVE', 'SUSPENDED', 'REMOVED'];
