import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { listMySessions, revokeOtherSessions, revokeSession } from "@/shared/api";

const sessionsKeys = {
  mine: ["sessions", "me"] as const,
};

export function useMySessionsQuery() {
  return useQuery({
    queryKey: sessionsKeys.mine,
    queryFn: () => listMySessions(),
  });
}

export function useRevokeSessionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => revokeSession(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sessionsKeys.mine }),
  });
}

export function useRevokeOtherSessionsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => revokeOtherSessions(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sessionsKeys.mine }),
  });
}
