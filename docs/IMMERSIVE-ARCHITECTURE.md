# Continuum immersive interface

Implemented locally, 1 November 2026. No commit, push, or deployment. This guide supersedes the motion implementation details in `DESIGN-IMPLEMENTATION.md`; its living-archive art direction and original paper texture still apply.

## Animation ownership

- **AOS:** `src/lib/useAos.ts`, called by `PublicLayout.tsx`, lazily initializes AOS once and refreshes its targets after React route navigation and content changes. `src/styles/immersive.css` defines the entrance treatments. Content remains readable if the animation library fails to load. Reduced motion removes these transforms.
- **GSAP / ScrollTrigger:** `editorialMotion.ts`, `coreScroll.ts`, `workflowScroll.ts`, `spiralScroll.ts`, and `orbitScroll.ts` own continuous scroll progress, depth, pinning, and rotation. Media-query contexts revert on cleanup and breakpoint changes. AOS and GSAP do not animate the same element's transform.
- **Three.js:** `threeMemoryScene.ts`, loaded by `components/immersive/MemoryCore.tsx`, draws the interactive layered memory core, agent nodes, source, project, memory cards, and directional connections. Pointer dragging orbits the scene; raycasting selects nodes. Equivalent HTML selectors, mode controls, zoom controls, reset, and an inspector remain accessible.

The renderer limits pixel ratio to 1.5 and renders on changes rather than running a perpetual animation loop. An intersection observer pauses rendering offscreen. Unmount disposes geometries, materials, textures, renderer, observers, and input listeners. Context failure restores the simplified HTML model. Three.js and the scroll modules load separately from the initial application bundle.

## Ten reference techniques

These are original product-oriented adaptations of the [Framer University reference](https://framer.university/blog/10-scroll-animations-to-make-your-website-stand-out).

| Technique | Implementation and location |
| --- | --- |
| 3D scroll transforms | Layered archive papers and the Three.js memory core on Home; depth cards on Product |
| Sticky text storytelling | Home lifecycle chapters with a persistent reading index |
| Zoom into and out of a scene | Scroll-driven camera depth in Home's memory core; bounded interactive zoom |
| Scroll-driven media sequence | Six actual sample interface states, conversation through retrieval, on Home and Product; corresponding MCP code sequence on Developers |
| Pinned visual storytelling | Home's sticky narrative core changes capture/store/retrieve phase alongside the chapters |
| Integration ticker | Scroll-linked integration names and capability labels on Integrations |
| Rotating agent ring | Selectable agent ring with scroll rotation and provider setup details on Integrations |
| 3D spiral gallery | Six selectable memory categories with source evidence on Product |
| Horizontal workflow | Desktop pinned workflow track with step buttons and focus navigation; native horizontal scrolling on mobile |
| Layered parallax | Paper, source-document, editorial line, and memory-detail layers on Home |

The media sequence uses product interface panels, not a prerecorded video. The website has no autonomous ticker or decorative particle storm. Static paper grain, rules, dot grids, and restrained navy/cobalt depth carry the visual identity.

## Page and data boundaries

`Home.tsx` combines the interactive core, lifecycle story, workflow, and existing working Memory Loop sample. `PublicPages.tsx` composes Product's workflow/spiral, Integrations' ticker/ring, and Developers' authorization architecture/workflow. AOS also enhances Pricing and Docs.

Public demonstrations explicitly use sample content. They do not imply an authenticated provider session or successful production capture.

Authenticated Memories, Connections, and Projects use `RelationshipExplorer.tsx` and `relationships.css`. Memories additionally uses `MemoryRelationships.tsx` to request source evidence for the currently loaded records. Connections shows actual credential permissions, states, and explicit project grants; Projects shows loaded project records and reviewed handoff destinations. Inspector actions open the existing record dialogs. The diagrams do not grant permissions or create handoffs. No fabricated data is inserted when a workspace is empty.

These diagrams are bounded views of loaded records, not complete workspace topology. Their captions disclose display limits; the existing tables and filters remain available. `useRecords.ts` clears records on workspace changes and rejects stale request results. Supabase authorization remains the security boundary.

## Mobile and accessibility

- Mobile defaults to an HTML memory model; interactive 3D is opt-in. Text and selectors remain usable without WebGL.
- Horizontal pinning requires a fine pointer, width above 900px, and height of at least 650px. Smaller screens use native swipe scrolling and step controls.
- The spiral becomes a readable grid. The agent ring stops rotating on mobile, and relationship diagrams become cards with textual relationships.
- The system reduced-motion preference and persisted footer control disable continuous motion and 3D, while retaining content and interaction alternatives.
- Short laptop layouts compress the narrative core and index so sticky content fits. Keyboard focus and explicit buttons can navigate workflow states.

## Verification and limits

Commands: `pnpm build`, `pnpm test`, `pnpm test:e2e`, and `pnpm test:connections-ui`.

Final local results: production build passed, 44 database/unit/protocol tests passed, 32 public browser tests passed, and 8 authenticated UI tests passed. `git diff --check` passed. Screenshots are retained in `artifacts/design/`. Git HEAD remains `be341e81cb5e59b7af86a446092f24bf2b88c0f9`.

Browser coverage includes AOS activation across six routes and client navigation, actual WebGL node picking, drag/zoom/reset, offscreen pause, reduced motion, WebGL failure, bidirectional workflow progression, pin release, touch scrolling, spiral/ring selection, overflow checks, and authenticated relationship inspector actions. Product tests use authorized wire fixtures; database tests use PGlite. Neither proves acceptance against a hosted Supabase project or live provider accounts.

Desktop and mobile Chromium emulation are covered. Physical-device, Safari/Firefox, long-session GPU memory profiling, and production performance budgets remain external verification work. Vite reports bundle-size advisories for the initial application chunk (503.78 kB minified / 151.28 kB gzip) and lazy Three.js chunk (550.55 kB / 136.79 kB gzip). AOS (14.35 kB) and GSAP/ScrollTrigger (112.78 kB) are separate lazy chunks. No hosted sign-up, email delivery, billing transaction, or live provider session is claimed as tested.

The WebGL-unavailable tests intentionally force context creation to fail; Three.js logs a context error in those tests, and the fallback is asserted. Normal navigation is checked for uncaught page errors and missing GSAP target warnings.
