import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
gsap.registerPlugin(ScrollTrigger);
export function mountOrbitScroll(root: HTMLElement) {
  const media = gsap.matchMedia();
  media.add("(prefers-reduced-motion: no-preference)", () => {
    gsap.fromTo(
      root.querySelector(".agent-ticker-track"),
      { xPercent: 0 },
      {
        xPercent: -12,
        ease: "none",
        scrollTrigger: {
          trigger: root,
          start: "top bottom",
          end: "bottom top",
          scrub: 0.5,
        },
      },
    );
  });
  media.add(
    "(min-width:901px) and (prefers-reduced-motion: no-preference)",
    () => {
      gsap.fromTo(
        root.querySelector(".agent-ring"),
        { "--orbit-turn": "-20deg" },
        {
          "--orbit-turn": "25deg",
          ease: "none",
          scrollTrigger: {
            trigger: root,
            start: "top 85%",
            end: "bottom 30%",
            scrub: 0.7,
          },
        },
      );
    },
  );
  return () => media.revert();
}
