import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installDevMockIfRequested } from "./devMock";
import { applyWindowsScaleCompensation } from "./lib/windowsScale";
import "./styles/global.css";

installDevMockIfRequested();
applyWindowsScaleCompensation();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
