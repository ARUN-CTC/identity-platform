import { useQuery } from "@tanstack/react-query";

import { listLoginAttempts, listSecurityEvents, type LoginAttemptListParams, type SecurityEventListParams } from "@/shared/api";

export function useSecurityEventsQuery(params: SecurityEventListParams) {
  return useQuery({
    queryKey: ["security-audit", "events", params] as const,
    queryFn: () => listSecurityEvents(params),
    placeholderData: (previousData) => previousData,
  });
}

export function useLoginAttemptsQuery(params: LoginAttemptListParams) {
  return useQuery({
    queryKey: ["security-audit", "login-attempts", params] as const,
    queryFn: () => listLoginAttempts(params),
    placeholderData: (previousData) => previousData,
  });
}
