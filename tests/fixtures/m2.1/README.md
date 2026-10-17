# M2.1 test fixtures

## `openfilm-project/`

A small, self-contained project in the shape the pinned OpenFilm `e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3`
reads: `film.html` holds one `<section data-track="picture">` of three `<iframe>` clips and one
`<section data-track="narration">` `<audio>`, exactly as M1B's spike project did
(`spikes/openfilm-m1b/project/film.html`).

Provenance and licence:

- Written for this repository as an M2.1 test fixture. No upstream code and no M1B artifact is
  copied into it; only the *file shape* is shared, which is a fact about the pinned upstream's
  format, not its code.
- All text is original and contains no real narration, no third-party media and no personal data.
- The binary files (`poster.png`, `narration.m4a`, `font.woff2`) are deterministic placeholder
  byte strings, not decodable media. M2.1 hashes and resolves references; it does not decode media,
  and it never claims to. Extensions were chosen so the fixture is not caught by the repository's
  `*.mp4` / `*.wav` ignore rules.
- The upstream project itself is MIT (`spikes/openfilm-m1b/upstream-lock.json`).

Why a declared-root design: `narration.vtt` and `settings.json` are referenced by the OpenFilm
runtime rather than by `film.html`, so the digest roots are declared by the Host instead of being
inferred. That is the same discipline `03_M2_M4_MODULE_DESIGN.md:30` requires — the closure must be
complete, and completeness is a Host-declared fact, not a guess.

Reference closure this fixture is built to exercise:

| File | Role | Reached by |
|---|---|---|
| `film.html` | `entry` | declared root |
| `scenes/shot-01.html` | `scene` | `<iframe src>` from the entry |
| `scenes/shot-02.html`, `scenes/shot-03.html` | `scene` | `<iframe src>` from the entry |
| `assets/theme.css` | `css` | `<link href>` from the entry and from each scene |
| `assets/tokens.css` | `css` | `@import` from `theme.css` |
| `assets/font.woff2` | `font` | `url(...)` inside an inline `<style>` in `shot-01.html` |
| `assets/narration.vtt` | `subtitle` | declared root |
| `assets/settings.json` | `settings` | declared root |
| `assets/poster.png` | asset | `url(...)` from `theme.css` |
| `assets/narration.m4a` | asset | `<audio src>` from the entry |
| `assets/aaa-narration-alt.m4a` | asset | `<link rel="preload" href>` from `scenes/shot-03.html` |
| `assets/registered-only.m4a` | asset | **declared root only** — the Host registers it, `film.html` does not reference it |

The last row exists to make discovery order differ from path order: `aaa-narration-alt.m4a`
sorts first by UTF-8 path but is only reachable from the third scene, so it is discovered last.
That is what makes "assets keep semantic order, only files get sorted" observable rather than
untested.

`registered-only.m4a` covers the other side: a declared asset that nothing in the film references.
It proves the declared-asset path is load-bearing, so that unreferenced *cache* files are excluded
only because the Host never declares them — not because the resolver silently dropped them.

Regenerate nothing here by hand: any edit changes the fixture SHA recorded in
`docs/evidence/M2/M2.1/evidence-manifest.json`.
