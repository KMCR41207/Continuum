import { useEffect, type RefObject } from "react";

/** Optional animation bundle: the static layout remains usable if it cannot load. */
export function useEditorialMotion(
  root: RefObject<HTMLElement | null>,
  route: string,
  reduced: boolean,
) {
  useEffect(() => {
    if (reduced || !root.current) return;
    let cancelled = false;
    let dispose: (() => void) | undefined;
    void import("./editorialMotion")
      .then(({ mountEditorialMotion }) => {
        if (!cancelled && root.current)
          dispose = mountEditorialMotion(root.current);
      })
      .catch(() => {
        /* Fully visible static layout is the fallback. */
      });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [root, route, reduced]);
}
