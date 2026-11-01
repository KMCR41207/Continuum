import { useEffect, type RefObject } from "react";

let initialized = false;
/** AOS owns entrance states only. One global initialization, scoped route refreshes. */
export function useAos(
  root: RefObject<HTMLElement | null>,
  route: string,
  reduced: boolean,
) {
  useEffect(() => {
    const element = root.current;
    if (!element || reduced) return;
    let cancelled = false,
      frame = 0;
    let observer: MutationObserver | undefined;
    void import("aos")
      .then(({ default: AOS }) => {
        if (cancelled) return;
        if (!initialized) {
          AOS.init({
            duration: 650,
            easing: "ease-out-cubic",
            offset: 48,
            once: true,
            delay: 0,
            disableMutationObserver: true,
          });
          initialized = true;
        }
        const refresh = () => {
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => {
            const targets = element.querySelectorAll<HTMLElement>(
              ".hero-description, .section-heading, .inner-page > h1, .page-intro, .product-feature-list > article, .integration-grid > button, .pricing-grid > article, .footer-top > div, .control-section > div, .memory-section > div:first-child, [data-aos]",
            );
            targets.forEach((target, index) => {
              if (!target.dataset.aos)
                target.dataset.aos = target.matches(
                  ".integration-grid > button",
                )
                  ? "zoom-in"
                  : "fade-up";
              if (
                target.matches(".integration-grid > button, .footer-top > div")
              )
                target.dataset.aosDelay = String((index % 3) * 60);
            });
            element.dataset.aosReady = "true";
            AOS.refreshHard();
          });
        };
        refresh();
        observer = new MutationObserver(refresh);
        observer.observe(element, { childList: true, subtree: true });
      })
      .catch(() => {
        /* Visible default styles preserve all content if AOS cannot load. */
      });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      delete element.dataset.aosReady;
    };
  }, [root, route, reduced]);
}
