import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/fira-code/400.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/cascadia-code/400.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/source-code-pro/400.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
