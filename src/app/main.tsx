import { exchangeWorkbenchFragment } from "./workbench-session.js";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { NarralensApp } from "./director/NarralensApp.js";
import "./styles.css";

// Exchange once before React StrictMode effects. Never persist the entry secret.
void exchangeWorkbenchFragment(window.location, window.history).then(() => {
  createRoot(document.getElementById("root")!).render(<StrictMode><NarralensApp /></StrictMode>);
}).catch(() => {
  const root = document.getElementById("root")!;
  const message = document.createElement("p");
  message.setAttribute("role", "alert");
  message.textContent = "工作台入口已失效，请从本机启动入口重新打开。";
  root.replaceChildren(message);
});
