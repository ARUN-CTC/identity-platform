import "vitest";

// jest-axe ships Jest-namespace types only; this re-declares its one matcher
// against Vitest's Assertion interface so `expect(...).toHaveNoViolations()`
// typechecks (the runtime matcher itself is registered in test/setup.ts).
declare module "vitest" {
  interface Assertion {
    toHaveNoViolations(): void;
  }
  interface AsymmetricMatchersContaining {
    toHaveNoViolations(): void;
  }
}
