import { createRoot } from "react-dom/client";
import { M5Panel } from "./M5Panel.js";
import "./m5.css";

/**
 * The M5 panel's entry point.
 *
 * It is mounted into the element the Studio bridge created, inside the *Studio's own
 * page*. There is no second page and no second application: the panel is a column on the
 * right of the native editor, and the native timeline stays the only timeline.
 */
const mount = document.getElementById("narralens-m5-panel");
if (mount !== null) {
  mount.setAttribute("data-narralens-panel", "mounted");
  createRoot(mount).render(<M5Panel />);
}
