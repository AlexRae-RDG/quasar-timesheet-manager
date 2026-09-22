import { useEffect, useRef } from "react";

/** Adds .page-header-stuck to the returned ref's element once the nearest
 * .shell-content ancestor has scrolled at all -- pair with .page-header
 * .page-header-sticky on the element itself (see global.css's
 * .page-header-stuck for the actual visual treatment: nothing at rest,
 * a plain solid/blurred bar matching .shell-header once scrolled).
 * Toggled straight on the DOM node rather than through React state, so a
 * real trackpad's fast momentum scroll can't outrun a render cycle and
 * visibly lag behind the true scroll position. */
export function useStickyHeader<T extends HTMLElement>() {
  const headerRef = useRef<T | null>(null);
  useEffect(() => {
    const scrollEl = document.querySelector<HTMLElement>(".shell-content");
    const header = headerRef.current;
    if (!scrollEl || !header) return;

    function check() {
      header?.classList.toggle("page-header-stuck", (scrollEl?.scrollTop ?? 0) > 0);
    }
    check();
    scrollEl.addEventListener("scroll", check, { passive: true });
    return () => scrollEl.removeEventListener("scroll", check);
  }, []);
  return headerRef;
}
