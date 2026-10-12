import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { NarralensApp } from "./director/NarralensApp.js";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<StrictMode><NarralensApp /></StrictMode>);
