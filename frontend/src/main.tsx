import React from "react";
import ReactDOM from "react-dom/client";
import "katex/dist/katex.min.css";
import "./styles.css";
import "./glossx.css";
import App from "./App";
import { initDesktopChrome } from "./desktop";
import { initDesktopActions } from "./desktopActions";
import { installZoom } from "./zoom";
import { initMobileClient } from "./mobile";

initMobileClient();
initDesktopChrome();
initDesktopActions();
installZoom();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
