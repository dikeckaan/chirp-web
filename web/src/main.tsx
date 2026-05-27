import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Service worker — cache Pyodide + CHIRP bundle for offline / fast
// reloads. Skip in dev so source changes aren't shadowed.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("/sw.js").catch((e) => {
    console.warn("Service worker registration failed:", e);
  });
}
