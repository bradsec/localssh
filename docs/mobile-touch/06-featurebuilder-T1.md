# T1 featurebuilder report

Status: blocked before implementation. No feature files changed, tests added, or commits made.

Building: a persisted line-height preference for browser SSH users; done means changing Appearance updates live terminal row spacing and PTY fit, and reload preserves it.

Plan conflict: T1 requires `lineHeight: number` in `TerminalSettings` [05-implementationplanner.md:36](05-implementationplanner.md#L36). `TerminalSettingsProps.value` requires `TerminalSettings` [frontend/src/components/TerminalSettings.tsx:8](../../frontend/src/components/TerminalSettings.tsx#L8). The typed fixture passed to that component in [frontend/src/components/toolbarLabels.test.tsx:8](../../frontend/src/components/toolbarLabels.test.tsx#L8) lacks `lineHeight`. The frontend TypeScript build includes all of `src` [frontend/tsconfig.app.json:19](../../frontend/tsconfig.app.json#L19), so T1 would make `npm run build` fail. That test file is outside T1's write set and the lead's `App.tsx` addition. The instruction to stop when the plan conflicts with code applies.

Checks run: `rtk git status --short` confirmed the accepted dirty tree. Targeted source and plan inspection identified the type conflict. No T1 verify command ran because implementation stopped before the first test edit. Storage, browser behavior, lint, format, and build remain unverified.

Notes for the lead: add `frontend/src/components/toolbarLabels.test.tsx` to T1's write set so its fixture can include `lineHeight: 1.15`. `App.tsx` remains needed at both `<Terminal>` call sites. Preserve all accepted uncommitted work. No adjacent problems were investigated.
