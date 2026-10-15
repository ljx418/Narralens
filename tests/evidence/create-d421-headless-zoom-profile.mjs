import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const profileRoot = process.env.D421_PROFILE_ROOT;
if (!profileRoot) throw new Error("D421_PROFILE_ROOT is required");
const zoomFactor = Number.parseFloat(process.env.D421_ZOOM_FACTOR ?? "2");
if (!Number.isFinite(zoomFactor) || zoomFactor <= 0) throw new Error("D421_ZOOM_FACTOR must be positive");
const zoomLevel = Math.log(zoomFactor) / Math.log(1.2);
const defaultRoot = resolve(profileRoot, "Default");
await mkdir(defaultRoot, { recursive: true });
const preferences = { partition: { default_zoom_level: { x: zoomLevel } } };
await writeFile(resolve(defaultRoot, "Preferences"), `${JSON.stringify(preferences, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ zoom_factor: zoomFactor, zoom_level: zoomLevel, preference: "partition.default_zoom_level.x" })}\n`);
