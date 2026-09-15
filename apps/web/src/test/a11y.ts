import { axe, type JestAxeConfigureOptions } from "jest-axe";
import { expect } from "vitest";

type RuleOverrides = Record<string, { enabled: boolean }>;

/**
 * Rules that only make sense when auditing a full document (one <main>,
 * everything inside a landmark, a single <h1>, a lang attribute on <html>)
 * — every test here renders one component in isolation, not a page, so
 * these would fail regardless of the component's own accessibility.
 */
const DOCUMENT_LEVEL_RULES: RuleOverrides = {
  region: { enabled: false },
  "landmark-one-main": { enabled: false },
  "page-has-heading-one": { enabled: false },
  "html-has-lang": { enabled: false },
};

/** Runs axe-core against a rendered container and asserts zero violations. */
export async function expectNoA11yViolations(
  container: Element,
  options?: JestAxeConfigureOptions,
): Promise<void> {
  const extraRules = (options?.rules ?? {}) as RuleOverrides;
  const results = await axe(container, {
    ...options,
    rules: { ...DOCUMENT_LEVEL_RULES, ...extraRules },
  });
  expect(results).toHaveNoViolations();
}
