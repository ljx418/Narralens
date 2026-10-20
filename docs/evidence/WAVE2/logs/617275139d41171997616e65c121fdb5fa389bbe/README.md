# M4A formal capture

This directory is the clean, headless M4A capture bound to commit
`617275139d41171997616e65c121fdb5fa389bbe`.

- `check-1` and `check-2`: exit 0, 70 files / 853 tests each.
- `wave2-m4a`: exit 0, 8 files / 101 tests.
- `wave1-integrity`: expected exit 1 because its old current-tip invariant is superseded by later Wave 2 implementation; `wave1-historical` remains the authoritative historical gate and exits 0.
- All other recorded commands exit 0.

The manifest and integrity tool validate every command log, including expected-failure entries.
