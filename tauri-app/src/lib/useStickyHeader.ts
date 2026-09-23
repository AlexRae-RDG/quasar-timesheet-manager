import { useEffect, useRef } from "react";

/** Adds .page-header-stuck to the header ref's element once the nearest
 * .shell-content ancestor has scrolled at all -- pair with .page-header
 * .page-header-sticky on the element itself (see global.css's
 * .page-header-stuck for the actual visual treatment: nothing at rest,
 * a plain solid/blurred bar matching .shell-header once scrolled).
 * Toggled straight on the DOM node rather than through React state, so a
 * real trackpad's fast momentum scroll can't outrun a render cycle and
 * visibly lag behind the true scroll position.
 *
 * The second ref (bgRef) belongs on a `<div className="page-header-fixed-bg"
 * aria-hidden />` the caller renders as the header's first child -- a real
 * position:fixed layer behind the header's own content, not
 * background-attachment:fixed on the header itself. The header is
 * position:sticky, and Chromium (so WebView2 on Windows too) has a known
 * bug where a fixed background on a sticky element doesn't reliably stay
 * put during scroll, undoing the entire point of "freeze the gradient in
 * place" on a glass theme. A genuine position:fixed element never has
 * that problem, since it isn't sticky itself.
 *
 * position:fixed is viewport-relative, though, and the sticky header does
 * NOT sit at the very top of the viewport -- .shell-header/.shell-tab-row
 * sit above .shell-content, so "stuck" actually means pinned at
 * .shell-content's own top edge, wherever that lands (varies with
 * headerStyle). Both that offset and the header's own height are synced
 * live via ResizeObserver (on .shell-content, whose box does change
 * height when .shell-header's visibility/size toggles, and on the header
 * itself) rather than assumed/guessed -- exactly the kind of geometry
 * mismatch this treatment broke on before, twice now (once as a wrong
 * constant, once as an unstated assumption of top: 0).
 *
 * This element has to be real JSX the caller renders, not a node this
 * hook inserts imperatively (an earlier version tried that, via
 * `header.prepend(...)`) -- mutating a React-managed element's children
 * outside React fights its own reconciliation on the next render (React
 * expects the header's first child to match what it rendered, and
 * "fixes" the mismatch itself), which broke the header's own
 * position:sticky layout outright rather than just looking wrong. */
export function useStickyHeader<T extends HTMLElement>() {
  const headerRef = useRef<T | null>(null);
  const bgRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const scrollEl = document.querySelector<HTMLElement>(".shell-content");
    const header = headerRef.current;
    const bg = bgRef.current;
    if (!scrollEl || !header) return;

    function syncGeometry() {
      if (!bg) return;
      bg.style.top = `${scrollEl?.getBoundingClientRect().top ?? 0}px`;
      bg.style.height = `${header?.getBoundingClientRect().height ?? 0}px`;
    }
    const resizeObserver = new ResizeObserver(syncGeometry);
    resizeObserver.observe(header);
    resizeObserver.observe(scrollEl);
    syncGeometry();

    function check() {
      header?.classList.toggle("page-header-stuck", (scrollEl?.scrollTop ?? 0) > 0);
    }
    check();
    scrollEl.addEventListener("scroll", check, { passive: true });

    return () => {
      scrollEl.removeEventListener("scroll", check);
      resizeObserver.disconnect();
    };
  }, []);

  return { headerRef, bgRef };
}
