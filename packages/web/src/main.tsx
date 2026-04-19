import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "sonner/dist/styles.css";
import { App } from "./app.js";
import "./styles.css";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Root container not found");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
