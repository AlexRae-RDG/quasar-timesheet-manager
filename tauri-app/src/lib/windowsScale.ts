/** Windows' own scaling options (100%/125%/150%/...) make WebView2 render
 * every CSS pixel that many times bigger, same as any web page on a hi-DPI
 * display -- most colleagues are on the 150% default, where this app (built
 * and eyeballed at 100%) ends up visibly larger/coarser than intended. This
 * counters that with an equal-and-opposite CSS zoom, so the app always
 * looks like its 100% self regardless of the Windows scale setting.
 *
 * Windows-only: on macOS, devicePixelRatio > 1 means a real Retina display
 * where "twice the pixels, same logical size" is already correct and
 * expected, not a scale setting to fight -- zooming out there would just
 * make the whole app shrink for no reason. `zoom` (not a `transform:
 * scale`) is what makes this render crisp rather than blurry: it still
 * renders using the monitor's full pixel density for the finer layout it
 * produces, rather than stretching a fixed-resolution bitmap.
 */
export function applyWindowsScaleCompensation() {
  if (typeof navigator === "undefined" || !navigator.userAgent.includes("Windows")) return;
  const root = document.documentElement;

  function apply() {
    root.style.zoom = String(1 / window.devicePixelRatio);
  }
  apply();

  // devicePixelRatio has no change event of its own -- matchMedia's
  // documented pattern for tracking it is a media query pinned to the
  // *current* ratio, which fires "change" the moment that ratio stops
  // matching (the Windows scale setting changed, or the window moved to a
  // different-DPI monitor); re-subscribing at the new ratio each time keeps
  // this live for the rest of the session instead of a one-shot check.
  function watch() {
    const mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mql.addEventListener(
      "change",
      () => {
        apply();
        watch();
      },
      { once: true },
    );
  }
  watch();
}
