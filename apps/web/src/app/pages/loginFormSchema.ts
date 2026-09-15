import { z } from "zod";

// Mirrors src/modules/authentication/dto/login.dto.ts — login itself
// enforces no password complexity (that's only checked on create/change
// password), so this stays intentionally permissive.
export const loginFormSchema = z.object({
  tenantCode: z.string().min(1, "Required").max(30, "Must be 30 characters or fewer"),
  email: z.string().min(1, "Required").email("Enter a valid email address"),
  password: z.string().min(1, "Required"),
  rememberMe: z.boolean(),
});

export type LoginFormValues = z.infer<typeof loginFormSchema>;

export const emptyLoginFormValues: LoginFormValues = {
  tenantCode: "",
  email: "",
  password: "",
  rememberMe: false,
};
