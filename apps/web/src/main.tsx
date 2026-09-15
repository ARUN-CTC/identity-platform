import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { bootstrapApiClient } from "@/shared/api";

import { App } from "./App";
import "./index.css";

bootstrapApiClient();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
