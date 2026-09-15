import { z } from "zod";

// Mirrors src/modules/users/invitations/dto/accept-invitation.dto.ts (password: @MinLength(8) only).
export const acceptInvitationFormSchema = z
  .object({
    password: z.string().min(8, "Must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Required"),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export type AcceptInvitationFormValues = z.infer<typeof acceptInvitationFormSchema>;

export const emptyAcceptInvitationFormValues: AcceptInvitationFormValues = {
  password: "",
  confirmPassword: "",
};
