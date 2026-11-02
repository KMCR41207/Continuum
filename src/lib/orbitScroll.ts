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
        xPercent: -18,
        ease: "none",
        scrollTrigger: {
          trigger: root,
          start: "top bottom",
          end: "bottom top",
          scrub: 0.4,
        },
      },
    );
  });
  media.add(
    "(min-width:901px) and (prefers-reduced-motion: no-preference)",
    () => {
      gsap.fromTo(
        root.querySelector(".agent-ring"),
        { "--orbit-turn": "-25deg" },
        {
          "--orbit-turn": "30deg",
          ease: "none",
          scrollTrigger: {
            trigger: root,
            start: "top 85%",
            end: "bottom 30%",
            scrub: 0.5,
          },
        },
      );
      // Fade in the orbit layout on enter
      gsap.fromTo(
        root.querySelector(".orbit-layout"),
        { opacity: 0, y: 24 },
        {
          opacity: 1,
          y: 0,
          duration: 0.6,
          ease: "power2.out",
          scrollTrigger: {
            trigger: root,
            start: "top 80%",
            toggleActions: "play none none reverse",
          },
        },
      );
    },
  );
  return () => media.revert();
}
