# Continuum: the living archive

> Historical first design pass. The subsequent [immersive architecture guide](IMMERSIVE-ARCHITECTURE.md) supersedes the library choices, animation inventory, and verification counts below. AOS and Three.js are now implemented alongside GSAP.

Local design implementation, 1 November 2026. No commit, push, or deployment was performed.

## Direction and scope

The public website now uses a warm paper surface, ink-blue archive panels, large serif headlines, ruled layouts, and source-document motifs. Product, integration, pricing, and documentation routes inherit the public typography and navigation. Existing account and workspace behavior is preserved. The interactive Memory Loop still performs its complete labeled sample workflow; the artwork makes no new provider-integration claims.

Applied the user-provided `premium-aos-web-development` skill from `C:\Users\ksair\Downloads\codex-premium-aos-skills\.agents\skills\premium-aos-web-development\SKILL.md`, including its visual, motion, and verification references. The skill was read from its supplied location, not installed into a different folder.

## Motion and materials

The [Framer University article](https://framer.university/blog/10-scroll-animations-to-make-your-website-stand-out) supplied motion references. This is an original React implementation rather than a Framer embed or copied template.

| Reference approach | Continuum adaptation |
|---|---|
| Text reveals | Sequenced headline arrival and scroll-driven ink emphasis in the context-problem heading |
| Perspective / 3D transforms | Hero archive settles as it leaves the viewport; layered source, reviewed-memory, and context papers rotate in depth |
| Zoom | Memory detail straightens and grows into view; closing headline expands gently |
| Sticky storytelling | Lifecycle index stays alongside the source-to-reuse sequence on sufficiently tall desktop/tablet screens |
| Scroll-driven ticker / horizontal movement | Oversized editorial line responds to scroll position and reverses with scrolling |
| Scroll rotation | Closing and footer arrows rotate toward the direction of continuation |
| Layered parallax | Archive papers move at different depths and speeds; the hero and memory record move independently of their copy |
| Coordinated transitions | Chapter papers arrive as their reading index advances; the archive background changes through the sequence |

Video scrubbing, a literal mountain scene, and a full-screen spiral gallery were not inserted: the site's actual content is source-linked memory, not video or landscape imagery. The reference techniques were adapted to that content. There is no artificial vertical-to-horizontal scroll trap or looping autoplay ticker.

The original local `public/textures/paper-grain.svg` adds static paper grain. Fine dot-grid, vertical-rule, and hatch patterns are CSS. These are painted behind content, do not receive input, and have no external asset dependency. Georgia remains the intentional display fallback; no licensed Relona font was fabricated or downloaded.

## Implementation

- `src/pages/Home.tsx`: revised hero, editorial ticker, context heading, memory record, and closing section.
- `src/components/ContinuityStory.tsx`: readable chapters and a viewport-aware anchor index.
- `src/components/ArchiveSculpture.tsx`: decorative layered-paper composition with no duplicate screen-reader content.
- `src/components/PublicLayout.tsx`: sticky navigation, Escape-to-close menu, reliable cross-page anchors, footer signature, and persisted motion preference.
- `src/lib/useEditorialMotion.ts` / `editorialMotion.ts`: dynamically loaded GSAP/ScrollTrigger module, scoped selectors and reversible match-media lifecycle.
- `src/styles/editorial.css` / `motion.css`: scoped public design and materials; workspace UI retains its own density.
- `tests/browser/motion.spec.ts`: behavior checks for scroll direction, preferences, anchors, failure fallback, and responsive widths.

GSAP is the single coordinated animation system. Its approximately 45 KB gzipped module loads on public routes only when motion is permitted. No Lenis, AOS, wheel interception, or permanent animation frame loop was added. [ScrollTrigger](https://gsap.com/docs/v3/Plugins/ScrollTrigger/) and [matchMedia](https://gsap.com/docs/v3/GSAP/gsap.matchMedia()/) provide scroll synchronization and cleanup.

## Accessibility and resilience

- Native scrolling, keyboard controls, dialogs, and functional links remain available.
- The system reduced-motion preference disables the animation module. The footer also offers a persisted per-browser motion preference.
- On narrow/touch viewports, perspective, large parallax, rotating artwork, and zoom are removed. Lightweight reading/ticker effects remain unless reduced motion is enabled.
- Essential copy is never set to zero opacity or hidden pending a trigger. If the animation download fails, the static content and interactive demo still work.
- Motion teardown restores element styles on route changes, viewport changes, and preference changes. Buttons stay stationary during headline entrance.
- Cross-page anchors position immediately before timeline measurement; native in-page chapter links scroll smoothly unless reduced motion is active.

## Verification

Final test results are recorded in the project README and product implementation status. Dedicated motion checks cover forward/backward scrolling, chapter indication, system and saved reduced-motion preferences, Escape/focus behavior, cross-page anchors, route re-entry, animation-download failure, and overflow at 320, 390, 768, 1024, and 1440 pixels.

Desktop, tablet, and mobile screenshots were visually inspected. Browser checks use Playwright Chromium with desktop and mobile emulation; physical-device, Safari, and Firefox acceptance have not been run. Existing hosted Supabase, Stripe, and provider-account verification limitations remain unchanged.

Two new interaction defects found during verification were fixed: initial scroll measurement interrupting cross-route smooth anchors, and inline scroll-style restoration overriding a reduced-motion preference. The demo's prior headline assertion was updated to match the new copy and scoped to avoid matching a separate illustrative example.
