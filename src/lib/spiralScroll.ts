import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
gsap.registerPlugin(ScrollTrigger);
export function mountSpiralScroll(root: HTMLElement) {
  const media = gsap.matchMedia();
  media.add(
    "(min-width: 901px) and (pointer: fine) and (prefers-reduced-motion: no-preference)",
    () => {
      gsap.fromTo(
        root.querySelector(".spiral-arms"),
        { rotationY: -12, rotationX: 7 },
        {
          rotationY: 12,
          rotationX: -4,
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
