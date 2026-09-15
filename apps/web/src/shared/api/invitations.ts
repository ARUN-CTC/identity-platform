import { apiRequest } from "./client";

// Mirrors src/modules/users/invitations/dto/validate-invitation.dto.ts's ValidateInvitationResult.
export interface ValidateInvitationResult {
  valid: boolean;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
}

// Mirrors src/modules/users/invitations/dto/accept-invitation.dto.ts (password: min 8 chars).
export interface AcceptInvitationInput {
  token: string;
  password: string;
}

const BASE = "/invitations";

/**
 * Checks an invitation link before rendering the accept-invitation form —
 * lets the page fail fast on a dead/expired/already-used link and show who
 * is setting up an account. `@Public()` on the backend (no auth header
 * needed/sent). Unusually, this is a POST with the token as a query param,
 * not a body — mirrors the real controller signature exactly
 * (`@Post('validate') validate(@Query() query: ValidateInvitationDto)`).
 */
export function validateInvitation(token: string): Promise<ValidateInvitationResult> {
  return apiRequest<ValidateInvitationResult>(`${BASE}/validate`, { method: "POST", query: { token } });
}

/**
 * Sets a password and activates the invited membership. `@Public()` on the
 * backend. Concurrency-safe server-side (the token can only ever be
 * claimed once) — a second submission with the same token fails with the
 * same "invalid or expired" error as any other dead link, not a distinct
 * "already used" message.
 */
export function acceptInvitation(input: AcceptInvitationInput): Promise<null> {
  return apiRequest<null>(`${BASE}/accept`, { method: "POST", body: input });
}
