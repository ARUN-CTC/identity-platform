import { z } from "zod";

// Mirrors src/modules/authentication/dto/reset-password.dto.ts (newPassword: @MinLength(8) only).
export const resetPasswordFormSchema = z
  .object({
    newPassword: z.string().min(8, "Must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Required"),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export type ResetPasswordFormValues = z.infer<typeof resetPasswordFormSchema>;

export const emptyResetPasswordFormValues: ResetPasswordFormValues = {
  newPassword: "",
  confirmPassword: "",
};
