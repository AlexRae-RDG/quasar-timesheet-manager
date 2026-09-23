import {
  Children,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { getZoomFactor } from "../lib/windowsScale";

/** A drop-in replacement for <select>/<option>/<optgroup> that draws its
 * own popup list instead of the OS's -- WebView2 on Windows renders a
 * native <select> popup that looks dated and can't be themed at all (not
 * even a glass theme's blur/colors), unlike the closed box itself, which
 * CSS can already reach. Deliberately kept close to <select>'s own JSX
 * shape (<Dropdown> takes <DropdownOption>/<DropdownGroup> children, same
 * value/onChange props) so every call site could just rename tags rather
 * than restructure -- onChange always hands back a string, exactly like a
 * real <select>'s e.target.value, so existing Number(...)/as SomeType
 * conversions at call sites keep working unchanged. */

export function DropdownOption({
  value,
  disabled,
  children,
}: {
  value: string | number;
  disabled?: boolean;
  children: ReactNode;
}) {
  // Never rendered directly -- Dropdown reads these props straight off the
  // element via Children.forEach and only renders its own <li> for them.
  void value;
  void disabled;
  void children;
  return null;
}

export function DropdownGroup({ label, children }: { label: string; children: ReactNode }) {
  void label;
  void children;
  return null;
}

interface FlatOption {
  kind: "option";
  value: string;
  label: ReactNode;
  disabled?: boolean;
}
interface FlatGroup {
  kind: "group";
  label: string;
  options: FlatOption[];
}
type FlatItem = FlatOption | FlatGroup;

function flattenChildren(children: ReactNode): FlatItem[] {
  const items: FlatItem[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === DropdownOption) {
      const props = child.props as { value: string | number; disabled?: boolean; children: ReactNode };
      items.push({ kind: "option", value: String(props.value), label: props.children, disabled: props.disabled });
    } else if (child.type === DropdownGroup) {
      const props = child.props as { label: string; children: ReactNode };
      const options: FlatOption[] = [];
      Children.forEach(props.children, (grandchild) => {
        if (isValidElement(grandchild) && grandchild.type === DropdownOption) {
          const optProps = grandchild.props as { value: string | number; disabled?: boolean; children: ReactNode };
          options.push({
            kind: "option",
            value: String(optProps.value),
            label: optProps.children,
            disabled: optProps.disabled,
          });
        }
      });
      items.push({ kind: "group", label: props.label, options });
    }
  });
  return items;
}

function flatOptions(items: FlatItem[]): FlatOption[] {
  return items.flatMap((item) => (item.kind === "option" ? [item] : item.options));
}

export function Dropdown({
  value,
  onChange,
  children,
  disabled,
  className,
  placeholder,
  "data-tour": dataTour,
}: {
  value: string | number;
  onChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
  placeholder?: ReactNode;
  "data-tour"?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const [highlight, setHighlight] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const strValue = String(value);
  const items = flattenChildren(children);
  const options = flatOptions(items);
  const selected = options.find((o) => o.value === strValue);

  function close() {
    setOpen(false);
  }

  function openList() {
    if (disabled) return;
    const idx = options.findIndex((o) => o.value === strValue);
    setHighlight(idx >= 0 ? idx : 0);
    setOpen(true);
    // WebKit (this app's macOS webview) doesn't focus a <button> on a
    // plain mouse click the way Chromium does -- without this, opening
    // via mouse then immediately trying arrow keys would silently do
    // nothing there, unlike a native <select> (whose own click handling
    // focuses it consistently everywhere).
    triggerRef.current?.focus();
  }

  // Two-pass: render the list invisibly first so its real height can be
  // measured (a portal, so it isn't clipped by any scrolling ancestor --
  // QDM import's ~90-row list is exactly the case a non-portaled popup
  // would get clipped inside), then place it (above the trigger if there
  // isn't room below) and reveal it -- avoids a flash at the wrong spot.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const trigger = triggerRef.current;
    const list = listRef.current;
    if (!trigger || !list) return;
    // Windows scale compensation (windowsScale.ts) applies a CSS zoom to
    // <html>; document.body (and this portal, appended there) is still
    // inside that zoomed subtree, so a measured pixel value written back
    // into this position:fixed list's inline style needs dividing by the
    // zoom factor first -- see getZoomFactor's own comment.
    const zoom = getZoomFactor();
    const t = trigger.getBoundingClientRect();
    const listHeight = list.offsetHeight;
    const gap = 4;
    const spaceBelow = window.innerHeight - t.bottom;
    const openAbove = spaceBelow < listHeight + gap && t.top > listHeight + gap;
    const top = openAbove ? t.top - listHeight - gap : t.bottom + gap;
    setPos({ left: t.left / zoom, top: top / zoom, width: t.width / zoom });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || listRef.current?.contains(target)) return;
      close();
    }
    function onWindowChange(e: Event) {
      // Scroll doesn't bubble, so this is on document with capture:true
      // specifically to catch it happening ANYWHERE, including inside the
      // list's own scrollable area (a long list, e.g. Activity, needs to
      // scroll internally) -- without this check, scrolling the list
      // itself closed it before a mouse-wheel or scrollbar-drag ever
      // reached the second option. Only a scroll OUTSIDE the list (the
      // page behind it, a parent modal) still closes it, since that kind
      // invalidates the popup's measured position the same way resize does.
      if (e.target instanceof Node && listRef.current?.contains(e.target)) return;
      close();
    }
    // Document-level, not just the trigger's own onKeyDown below -- WebKit
    // (this app's macOS webview) doesn't focus a <button> on a plain mouse
    // click the way Chromium does, so a real click-to-open on macOS can
    // leave the trigger without DOM focus at all, and Escape would never
    // reach its onKeyDown handler. Closing on Escape regardless of focus
    // matches what opening it (a click, no focus required) already does.
    function onDocKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onDocKey);
    // A scroll or resize anywhere invalidates the popup's measured
    // position -- closing rather than re-tracking matches a native
    // select's own behavior, which also dismisses on scroll.
    document.addEventListener("scroll", onWindowChange, true);
    window.addEventListener("resize", onWindowChange);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onDocKey);
      document.removeEventListener("scroll", onWindowChange, true);
      window.removeEventListener("resize", onWindowChange);
    };
  }, [open]);

  function pick(option: FlatOption) {
    if (option.disabled) return;
    onChange(option.value);
    close();
    triggerRef.current?.focus();
  }

  function onTriggerKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const opt = options[highlight];
      if (opt) pick(opt);
    }
  }

  let renderIndex = -1;

  return (
    // display: contents -- this wrapper takes no box of its own, so the
    // trigger button below sits directly in whatever layout (flex row,
    // .field column, a QDM row) it was placed in, exactly where a bare
    // <select> used to. className/data-tour go on the button instead of
    // here for the same reason: a display:contents element's own
    // getBoundingClientRect() is an empty rect, which would silently
    // break the welcome tour's spotlight if it were ever pointed at one.
    <div className="dropdown">
      <button
        type="button"
        ref={triggerRef}
        className={"dropdown-trigger" + (className ? ` ${className}` : "")}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-tour={dataTour}
        onClick={(e) => {
          e.stopPropagation();
          if (open) close();
          else openList();
        }}
        onKeyDown={onTriggerKeyDown}
      >
        <span className={selected ? "dropdown-trigger-label" : "dropdown-trigger-placeholder"}>
          {selected ? selected.label : placeholder}
        </span>
      </button>
      {open &&
        createPortal(
          <ul
            className="dropdown-list"
            ref={listRef}
            role="listbox"
            style={
              pos
                ? { left: pos.left, top: pos.top, width: pos.width, visibility: "visible" }
                : { left: 0, top: 0, visibility: "hidden" }
            }
          >
            {items.map((item, i) => {
              if (item.kind === "group") {
                return (
                  <li key={`g${i}`} className="dropdown-group" role="presentation">
                    <div className="dropdown-group-label">{item.label}</div>
                    <ul className="dropdown-group-options" role="presentation">
                      {item.options.map((o) => {
                        renderIndex++;
                        const idx = renderIndex;
                        return (
                          <DropdownOptionRow
                            key={o.value}
                            option={o}
                            selected={o.value === strValue}
                            highlighted={idx === highlight}
                            onPick={() => pick(o)}
                          />
                        );
                      })}
                    </ul>
                  </li>
                );
              }
              renderIndex++;
              const idx = renderIndex;
              return (
                <DropdownOptionRow
                  key={item.value}
                  option={item}
                  selected={item.value === strValue}
                  highlighted={idx === highlight}
                  onPick={() => pick(item)}
                />
              );
            })}
          </ul>,
          document.body,
        )}
    </div>
  );
}

function DropdownOptionRow({
  option,
  selected,
  highlighted,
  onPick,
}: {
  option: FlatOption;
  selected: boolean;
  highlighted: boolean;
  onPick: () => void;
}) {
  return (
    <li
      role="option"
      aria-selected={selected}
      aria-disabled={option.disabled}
      className={
        "dropdown-option" +
        (selected ? " dropdown-option-selected" : "") +
        (highlighted ? " dropdown-option-highlighted" : "") +
        (option.disabled ? " dropdown-option-disabled" : "")
      }
      // A row's own onClick (e.g. a QDM row toggling its checkbox) can sit
      // right behind this in the DOM even though the popup is portaled --
      // stop the click from bubbling past the option the same way the old
      // <select>'s onClick={(e) => e.stopPropagation()} did at each call
      // site.
      onClick={(e) => {
        e.stopPropagation();
        onPick();
      }}
    >
      {option.label}
    </li>
  );
}
