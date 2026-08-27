"""
Standalone mouse-wheel/trackpad diagnostic -- NOT part of the app itself.
A minimal reproduction to isolate whether scroll events reach Tk *at all*
on this machine, decoupled from anything the real app's widget tree or
binding code might be doing differently.

Run directly from Terminal, in this same folder:

    python3 wheel_diagnostic.py

Then, with the small window that opens in focus:
  1. Move the mouse over it a little first (just to see [motion] lines).
  2. Scroll over the blue canvas.
  3. Scroll over the plain gray background outside the canvas too.

Watch what prints in Terminal, then send that output back.
"""
import tkinter as tk

root = tk.Tk()
root.title("Wheel Diagnostic")
root.geometry("500x420+200+200")

print("Tcl/Tk patchlevel:", root.tk.eval("info patchlevel"))
print("Windowing system:", root.tk.call("tk", "windowingsystem"))

label = tk.Label(
    root,
    text="Move the mouse here, then scroll --\nfirst over the blue box, then over this gray area.",
    font=("Helvetica", 13), pady=20, justify="center",
)
label.pack()

canvas = tk.Canvas(root, bg="#4C6EF5", width=400, height=220,
                    highlightthickness=2, highlightbackground="black")
canvas.pack(padx=20, pady=10)
canvas.create_text(200, 110, text="scroll over me too", fill="white", font=("Helvetica", 12))

counts = {"motion": 0, "wheel": 0, "b4": 0, "b5": 0}


def on_motion(_event):
    counts["motion"] += 1
    if counts["motion"] in (1, 20, 60):
        print(f"[motion] mouse events are reaching Tk fine (seen {counts['motion']} so far)")


def on_wheel(event, tag):
    counts["wheel"] += 1
    print(f"[MouseWheel]{tag} delta={event.delta} x={event.x} y={event.y} widget={event.widget}")


def on_button4(event, tag):
    counts["b4"] += 1
    print(f"[Button-4 / scroll up]{tag} x={event.x} y={event.y} widget={event.widget}")


def on_button5(event, tag):
    counts["b5"] += 1
    print(f"[Button-5 / scroll down]{tag} x={event.x} y={event.y} widget={event.widget}")


# Global (bind_all): should catch a <MouseWheel>/<Button-4>/<Button-5>
# event fired ANYWHERE in this process, no matter which specific widget
# it targets -- this is the most-global binding Tk offers.
root.bind_all("<MouseWheel>", lambda e: on_wheel(e, " [bind_all]"))
root.bind_all("<Button-4>", lambda e: on_button4(e, " [bind_all]"))
root.bind_all("<Button-5>", lambda e: on_button5(e, " [bind_all]"))

# Direct, per-widget binding too, in case bind_all itself behaves
# differently from a plain widget-level bind on this particular Tk build.
for widget in (root, label, canvas):
    widget.bind("<MouseWheel>", lambda e: on_wheel(e, " [direct]"), add="+")
    widget.bind("<Button-4>", lambda e: on_button4(e, " [direct]"), add="+")
    widget.bind("<Button-5>", lambda e: on_button5(e, " [direct]"), add="+")

root.bind_all("<Motion>", on_motion, add="+")

print("\nReady. Move the mouse over the window, then try scrolling over both")
print("the blue box and the plain gray area. If [motion] lines appear but no")
print("[MouseWheel]/[Button-4]/[Button-5] line ever does, no matter where you")
print("scroll, this Tk build isn't translating the scroll gesture into any")
print("event a Tk widget can bind to at all.\n")

root.mainloop()
