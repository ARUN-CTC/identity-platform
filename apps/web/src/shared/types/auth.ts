export interface AuthUser {
  id: string;
  displayName: string;
  email: string;
  avatarUrl?: string;
  initials: string;
}

export interface Tenant {
  id: string;
  name: string;
  code: string;
}

/** The organization the caller is currently acting within — null means tenant-wide, the default. */
export interface OrganizationContext {
  id: string;
  name: string;
}
