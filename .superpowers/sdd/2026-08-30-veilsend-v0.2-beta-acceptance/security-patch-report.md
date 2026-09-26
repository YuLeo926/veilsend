# Vitest security patch report

Base commit: `9e1727f`  
Dependency patch commit: `6040c3d`  
Advisory: https://github.com/advisories/GHSA-82fw-gwwq-j7x9

## Changes

- `package.json`: raised the Vitest development dependency floor from `^4.1.10` to `^4.1.11`.
- `package-lock.json`: updated `vitest` and its seven `@vitest/*` packages (`expect`, `mocker`, `pretty-format`, `runner`, `snapshot`, `spy`, and `utils`) from 4.1.10 to 4.1.11. No other dependency version changed.
- Preserved `0.2.0-beta.1` and every package script. The third-party license notice remained current, so regeneration was not needed.

## Verification

| Command | Result |
| --- | --- |
| `npm ci --ignore-scripts --no-audit --no-fund` | Passed; clean install from lockfile. |
| `npm ls vitest @vitest/mocker --all` | Installed `vitest@4.1.11` and `@vitest/mocker@4.1.11`. |
| `npm test` | Passed: 15 files, 117 tests. |
| `npm run test:release` | Passed: 16 tests. |
| `npm run build` | Passed. |
| `npm run check:licenses` | Passed; `THIRD_PARTY_LICENSES.md` is current. |
| `npm run check:release` | Passed; reports `0.2.0-beta.1`. |
| `npm audit --json` | Passed; zero vulnerabilities of any severity. GHSA-82fw-gwwq-j7x9 is absent. |
| `git diff --check` | Passed. |

Remaining audit output: `vulnerabilities: {}`; info 0, low 0, moderate 0, high 0, critical 0, total 0.

No Rust tests were rerun, per the patch brief.
