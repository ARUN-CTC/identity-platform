import { z } from "zod";

// Mirrors src/modules/authentication/dto/forgot-password.dto.ts
export const forgotPasswordFormSchema = z.object({
  tenantCode: z.string().min(1, "Required").max(30, "Must be 30 characters or fewer"),
  email: z.string().min(1, "Required").email("Enter a valid email address"),
});

export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordFormSchema>;

export const emptyForgotPasswordFormValues: ForgotPasswordFormValues = {
  tenantCode: "",
  email: "",
};
