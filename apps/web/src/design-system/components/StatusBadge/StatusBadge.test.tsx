import { describe, expect, it } from "vitest";

import { renderWithProviders } from "@/test/render-with-providers";

import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it("renders the title-cased status label by default", () => {
    const { getByText } = renderWithProviders(<StatusBadge status="active" />);
    expect(getByText("Active")).toBeInTheDocument();
  });

  it("renders a custom label when provided", () => {
    const { getByText, queryByText } = renderWithProviders(<StatusBadge status="pending" label="Pending Review" />);
    expect(getByText("Pending Review")).toBeInTheDocument();
    expect(queryByText("Pending")).not.toBeInTheDocument();
  });
});
