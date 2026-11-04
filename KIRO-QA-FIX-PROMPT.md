# Continuum local QA findings and requested fixes

Please inspect and fix the actual issues below in this project. Preserve the existing visual design and product behavior; do not do a broad redesign.

## Browser QA already performed
- Homepage: HTTP 200, title `Continuum — One memory. Every intelligence.`
- Desktop viewport 1440x1000 and mobile viewport 390x844: no horizontal overflow.
- No failed image loads, page exceptions, console errors, or failed network requests on the homepage.
- Routes `/product`, `/integrations`, `/developers`, `/pricing`, `/docs`, `/privacy`, `/terms`, `/security`, `/contact` all returned HTTP 200 and rendered an H1.
- Workflow step buttons 1–6 and `View source` were clickable without browser errors.
- Some canvas controls are not exposed as accessible buttons by their visible text; inspect whether this is intentional and improve semantics if needed without changing the design.
- `Capture conversation` did not complete in the automated click test within 3 seconds; investigate whether it is blocked by animation/overlay, is not a real interactive action, or has a real functional issue. Do not fake a successful capture or alter sample-only messaging.

## Build warning to investigate
`pnpm build` succeeds and `tsc --noEmit` passes, but Vite warns about chunks larger than 500 kB. Current output includes a main JS chunk around 511 kB and a Three.js chunk around 743 kB. Review the existing lazy-loading and bundle structure. Apply safe code splitting or dynamic imports only if it materially improves initial loading and does not introduce circular chunks or break 3D functionality. Do not merely raise the warning threshold to hide it.

## Required work
1. Inspect relevant components and route/interaction implementations.
2. Reproduce and diagnose the capture interaction and accessibility concerns.
3. Fix only confirmed issues with minimal changes.
4. Run `pnpm typecheck`, `pnpm test`, and `pnpm build` after changes.
5. Re-run the local browser smoke tests at desktop and mobile sizes and verify all routes and interactions.
6. Report exactly what changed, test results, and any remaining known limitations. Do not claim a fix unless verified.
