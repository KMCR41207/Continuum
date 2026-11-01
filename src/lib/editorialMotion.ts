import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

/** One animation owner. No wheel interception, artificial scroll engine, or per-frame React state. */
export function mountEditorialMotion(root: HTMLElement) {
  const media = gsap.matchMedia();
  const select = <T extends Element = HTMLElement>(selector: string) =>
    Array.from(root.querySelectorAll<T>(selector));
  media.add(
    {
      motion: "(prefers-reduced-motion: no-preference)",
      desktop: "(min-width: 901px) and (pointer: fine)",
    },
    (context) => {
      if (!context.conditions?.motion) return;
      const desktop = Boolean(context.conditions.desktop);
      const scrub = desktop ? 0.65 : 0.25;
      const arrival = select(".hero-copy > .eyebrow, .hero h1 .title-line");
      // Essential copy is never set to opacity zero or left waiting for a scroll trigger.
      if (arrival.length)
        gsap.from(arrival, {
          y: desktop ? 26 : 12,
          opacity: 0.7,
          duration: 0.85,
          stagger: 0.075,
          ease: "power3.out",
          clearProps: "transform,opacity",
        });
      select(".scroll-ink").forEach((block) => {
        const words = block.querySelectorAll(".ink-word");
        gsap.fromTo(
          words,
          { color: "#73776e" },
          {
            color: "#171a21",
            stagger: 0.12,
            ease: "none",
            scrollTrigger: {
              trigger: block,
              start: "top 83%",
              end: "bottom 48%",
              scrub,
            },
          },
        );
      });
      select(".scroll-ticker").forEach((ticker) => {
        gsap.fromTo(
          ticker.querySelector(".ticker-track"),
          { xPercent: 0 },
          {
            xPercent: desktop ? -18 : -10,
            ease: "none",
            scrollTrigger: {
              trigger: ticker,
              start: "top bottom",
              end: "bottom top",
              scrub,
            },
          },
        );
      });
      // The vertical index is functional; only example paper moves into place.
      select(".chapter-example").forEach((paper) => {
        gsap.fromTo(
          paper,
          {
            y: desktop ? 38 : 12,
            rotationX: desktop ? 7 : 0,
            transformPerspective: 1000,
          },
          {
            y: 0,
            rotationX: 0,
            ease: "none",
            scrollTrigger: {
              trigger: paper.parentElement,
              start: "top 85%",
              end: "center 55%",
              scrub,
            },
          },
        );
      });
      const story = root.querySelector(".continuity-story");
      if (story)
        gsap.fromTo(
          story,
          { backgroundColor: "#243c47" },
          {
            backgroundColor: "#152734",
            ease: "none",
            scrollTrigger: {
              trigger: story,
              start: "top bottom",
              end: "bottom bottom",
              scrub,
            },
          },
        );
      if (desktop) {
        const hero = root.querySelector(".hero");
        const visual = root.querySelector(".archive-path");
        if (hero && visual) {
          gsap.fromTo(
            visual,
            { rotationY: -5, rotationX: 2, transformPerspective: 1400 },
            {
              rotationY: 0,
              rotationX: 0,
              y: -26,
              ease: "none",
              scrollTrigger: {
                trigger: hero,
                start: "top top",
                end: "bottom top",
                scrub,
              },
            },
          );
        }
        const memory = root.querySelector(".memory-section");
        if (memory) {
          gsap.fromTo(
            memory.querySelector(".memory-preview"),
            { rotation: 3, scale: 0.92, y: 28 },
            {
              rotation: 0,
              scale: 1,
              y: -8,
              ease: "none",
              scrollTrigger: {
                trigger: memory,
                start: "top 90%",
                end: "center 45%",
                scrub,
              },
            },
          );
        }
        const sculpture = root.querySelector(".archive-sculpture");
        if (sculpture && story) {
          gsap.fromTo(
            sculpture.querySelector(".archive-orbit"),
            { rotationY: -20, rotationX: 12 },
            {
              rotationY: 28,
              rotationX: -6,
              ease: "none",
              scrollTrigger: {
                trigger: story,
                start: "top 60%",
                end: "bottom 85%",
                scrub: 0.9,
              },
            },
          );
          select(".archive-sheet").forEach((sheet, index) => {
            gsap.to(sheet, {
              y: (index - 1) * -24,
              rotation: (index - 1) * 5,
              ease: "none",
              scrollTrigger: {
                trigger: story,
                start: "top 65%",
                end: "bottom 90%",
                scrub: 0.8,
              },
            });
          });
        }
        select(".closing-mark, .footer-signature > span").forEach((mark) => {
          gsap.fromTo(
            mark,
            { rotation: -35, y: 35 },
            {
              rotation: 0,
              y: -10,
              ease: "none",
              scrollTrigger: {
                trigger: mark.parentElement,
                start: "top bottom",
                end: "bottom bottom",
                scrub: 0.7,
              },
            },
          );
        });
        select(".closing-cta h2").forEach((heading) => {
          gsap.fromTo(
            heading,
            { scale: 0.94, transformOrigin: "left center" },
            {
              scale: 1,
              ease: "none",
              scrollTrigger: {
                trigger: heading.parentElement,
                start: "top bottom",
                end: "center 60%",
                scrub,
              },
            },
          );
        });
      }
      const frame = requestAnimationFrame(() => ScrollTrigger.refresh());
      return () => cancelAnimationFrame(frame);
    },
    root,
  );
  return () => media.revert();
}
