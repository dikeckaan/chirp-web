import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// The COI service worker is registered inline from index.html so it
// can intercept the first navigation. Dev (vite serves COOP/COEP
// headers natively) doesn't need it.
