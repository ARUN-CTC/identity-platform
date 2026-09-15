import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";

import { AppProviders } from "@/app/providers";

/** Renders with the full provider stack + a MemoryRouter, for components that read router/theme/permission context. */
export function renderWithProviders(ui: ReactElement, options?: RenderOptions & { route?: string }) {
  const { route = "/", ...renderOptions } = options ?? {};
  return render(
    <AppProviders>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </AppProviders>,
    renderOptions,
  );
}
