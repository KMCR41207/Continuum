import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
gsap.registerPlugin(ScrollTrigger);
export function mountWorkflowScroll(
  root: HTMLElement,
  track: HTMLElement,
  active: (index: number) => void,
) {
  const media = gsap.matchMedia();
  let trigger: ScrollTrigger | undefined;
  media.add(
    "(min-width: 901px) and (min-height: 650px) and (pointer: fine) and (prefers-reduced-motion: no-preference)",
    () => {
      root.dataset.horizontal = "true";
      const distance = () =>
        Math.max(0, track.scrollWidth - track.parentElement!.clientWidth);
      const tween = gsap.to(track, {
        x: () => -distance(),
        ease: "none",
        scrollTrigger: {
          trigger: root.querySelector(".workflow-pin"),
          start: "top 100px",
          end: () => `+=${Math.min(1800, distance())}`,
          pin: true,
          scrub: 0.45,
          invalidateOnRefresh: true,
          onUpdate: (self) =>
            active(Math.min(5, Math.round(self.progress * 5))),
        },
      });
      trigger = tween.scrollTrigger;
      const frame = requestAnimationFrame(() => ScrollTrigger.refresh());
      return () => {
        cancelAnimationFrame(frame);
        delete root.dataset.horizontal;
        trigger = undefined;
      };
    },
  );
  return {
    jump(index: number) {
      if (trigger)
        window.scrollTo({
          top: trigger.start + ((trigger.end - trigger.start) * index) / 5,
          behavior: "instant",
        });
      else {
        const card = track.children[index] as HTMLElement;
        track.scrollTo({ left: card.offsetLeft, behavior: "smooth" });
        active(index);
      }
    },
    dispose: () => media.revert(),
  };
}
