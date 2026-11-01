import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
gsap.registerPlugin(ScrollTrigger);
export function mountCoreScroll(
  root: HTMLElement,
  update: (progress: number) => void,
) {
  const context = gsap.matchMedia();
  context.add(
    "(min-width: 901px) and (prefers-reduced-motion: no-preference)",
    () => {
      const progress = { value: 0 };
      gsap.to(progress, {
        value: 1,
        ease: "none",
        scrollTrigger: {
          trigger: root.closest("[data-core-story]") || root,
          start: "top 65%",
          end: "bottom 35%",
          scrub: 0.6,
        },
        onUpdate: () => update(progress.value),
      });
    },
  );
  return () => context.revert();
}
