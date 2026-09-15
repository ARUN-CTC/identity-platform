import { describe, expect, it } from "vitest";

import { emptyLoginFormValues, loginFormSchema } from "./loginFormSchema";

const validValues = { ...emptyLoginFormValues, tenantCode: "DEFAULT", email: "admin@example.com", password: "ChangeMe123!" };

describe("loginFormSchema", () => {
  it("accepts valid credentials", () => {
    expect(loginFormSchema.safeParse(validValues).success).toBe(true);
  });

  it("requires tenantCode, email, and password", () => {
    expect(loginFormSchema.safeParse({ ...validValues, tenantCode: "" }).success).toBe(false);
    expect(loginFormSchema.safeParse({ ...validValues, email: "" }).success).toBe(false);
    expect(loginFormSchema.safeParse({ ...validValues, password: "" }).success).toBe(false);
  });

  it("rejects a malformed email", () => {
    expect(loginFormSchema.safeParse({ ...validValues, email: "not-an-email" }).success).toBe(false);
  });

  it("does not enforce password complexity — login has none server-side, only create/change do", () => {
    expect(loginFormSchema.safeParse({ ...validValues, password: "x" }).success).toBe(true);
  });
});
