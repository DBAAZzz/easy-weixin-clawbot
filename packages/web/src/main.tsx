import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./app.js";

const container = document.getElementById("root");

function render() {
  if (!container) {
    throw new Error("Root container not found");
  }
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

// Demo preview builds (VITE_API_MOCK=1) answer /api/* with the MSW mock layer
// before React mounts; production builds never load that module.
if (import.meta.env.VITE_API_MOCK === "1") {
  import("./mocking/start.js").then((module) => module.startApiMock()).then(render);
} else {
  render();
}
