# OwnedProjectEntry pure component candidate

2026-11-10. MAIN explicitly assigned the pure A05 component; sole writer PRODUCT Codex, starting HEAD e96ca4ce06fc6515c6351844ac4375f15e481a78 (clean). MAIN owns backend/auth/API/root/native opening. No Claude/provider, Host/browser/heavy tests requested or run. Existing CP/base remains ca5b67a8285b130c79055317c6202f73cfbb99c8, manifest532cd43c963a1c94de5f8ce34f3c6eb7281fded80047f74dc5dbe1a70aa65170.

Applied frontend-design skill under the approved R4/existing theme brief: reuse inherited --bg/#090b0f, --surface/#10141a, --text/#edf2f7, --muted/#93a1b2, --line/#2a3442, --accent2/#77b7ff (existing light theme overrides remain authoritative). Inherit existing Inter/Noto Sans SC/system font; heading28px, project title18px, content14px, factual metadata12px. Left aligned saved-project rows rather than a new app/dashboard/card gallery; each row exposes its title, actual saved facts, and one native-editor entry. At narrow widths the action follows the metadata. Keep status textual, focus visible, controls touchable, no motion or progress simulation. Review against brief: no hero metrics/new palette/display font, chat/timeline/wizard or fabricated project; theme variables and actual supplied facts take priority over skill generic design suggestions.

Implementation scope: src/app/observation/OwnedProjectEntry.tsx and OwnedProjectEntry.css only. Exact fixed props supplied by MAIN; no fetch, storage, timers, data sorting, fake project/default data, auth, open side effect or app mount. MAIN imports component directly and supplies real authorized project rows/callbacks.

## Candidate integration

Import `OwnedProjectEntry` directly from `src/app/observation/OwnedProjectEntry.js`; its TSX imports the independent CSS. Existing observation index is unchanged. Props exactly match MAIN assignment, with exported readonly `OwnedProjectEntryProject`/`OwnedProjectEntryProps` types. MAIN supplies real project order/paging/permissions and makes onOpen perform its controlled native opening. This component does no backend work and must not be treated as the native identity delegate.

The list shows actual title/version/save time/frame count, explicit attention/saved text, and optional collapsed exact save identifiers. Null/invalid numeric/time data is “待核对”; zero frames is “空工程”. Empty data directs the user to create via Agent, without a second wizard. Loading/error/current-page count/opening messages do not simulate percent progress or native load confirmation. Existing rows stay visible during refresh/error. All open controls disable during loading or any project opening; attention can never invoke onOpen. Reload/next also disable while busy, next exists only for hasNext. Semantic section/list/article/headings/dl/time/buttons, visible focus and native details afford keyboard use; narrow layout puts the open action beneath row content. No fonts/images/external assets downloaded.

## Verification / boundaries

Only source static preparation was authorized; **TypeScript/tests/build/browser/Host NOT_RUN**. No independent/visual/A05 PASS claimed. Static `git diff --cached --check` result recorded at handoff; this is whitespace-only and not a compile/accessibility test.

MAIN integration checks still required: real authorized data and zero-frame saved row; empty/loading/error; attention click/key blocked; any opening disables other rows; onReload/onNext/onOpen callbacks and actual selected project ID; null metadata; 390px/1366px and keyboard/focus/forced-colors; saved label never rendered as native loaded. MAIN is responsible for native session delegation/auth/currentness and final opening/reload errors. Removal of these two unmounted files/MAIN import is the reversible candidate rollback; no persisted project state changes.

Actual static check: `git diff --cached --check` exit0 on this five-file candidate (two source files + manifest/request/handoff). No runtime result inferred.
