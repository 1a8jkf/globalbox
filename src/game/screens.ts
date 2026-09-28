import { useCallback, useEffect, useRef, useState } from "react";
import type { Person } from "./types.ts";
export type Panel =
  "world" | "market" | "activity" | "offers" | "profile" | null;
export interface Confirmation {
  title: string;
  text: string;
  action: () => Promise<void>;
}
type Screen =
  | { kind: "panel"; value: Exclude<Panel, null> }
  | { kind: "auth" }
  | { kind: "layers" }
  | { kind: "person"; value: Person }
  | { kind: "confirmation"; value: Confirmation };
/** The top screen owns Back and controller input. Domain state stays outside this stack. */
export function useScreens() {
  const [stack, setStack] = useState<Screen[]>([]);
  const firstFocus = useRef(true);
  const returnFocus = useRef(new Map<Screen["kind"], HTMLElement | null>());
  const previousTop = useRef<Screen["kind"] | undefined>(undefined);
  const padHeld = useRef(false);
  const current = useRef(stack);
  current.current = stack;
  const open = useCallback((screen: Screen) => {
    returnFocus.current.set(
      screen.kind,
      document.activeElement as HTMLElement | null,
    );
    setStack((old) => [...old.filter((s) => s.kind !== screen.kind), screen]);
    history.pushState({ ...history.state, gtOverlay: true }, "", location.href);
  }, []);
  const remove = useCallback(
    (kind: Screen["kind"]) =>
      setStack((old) => old.filter((s) => s.kind !== kind)),
    [],
  );
  const pop = useCallback(() => setStack((old) => old.slice(0, -1)), []);
  const top = stack.at(-1)?.kind;
  const topScreen = stack.at(-1);
  const focusKey = topScreen?.kind === "panel" ? topScreen.value : top;
  useEffect(() => {
    const back = () => pop();
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, [pop]);
  useEffect(() => {
    const removed = previousTop.current;
    previousTop.current = top;
    const root = top
      ? document.querySelector<HTMLElement>(`[data-screen="${top}"]`)
      : document.querySelector<HTMLElement>(".app");
    if (!root) return;
    const modal = top === "auth" || top === "confirmation";
    const focusables = () =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input,select,a[href],[tabindex="0"]',
        ),
      ).filter((el) => el.getClientRects().length > 0);
    const focus = () => {
      const first =
        root.querySelector<HTMLElement>("[data-initial-focus]") ??
        focusables()[0];
      first?.focus();
    };
    const restore =
      removed && !current.current.some((s) => s.kind === removed)
        ? returnFocus.current.get(removed)
        : null;
    if (restore?.isConnected) restore.focus();
    else if (top || firstFocus.current) focus();
    firstFocus.current = false;
    if (modal) {
      root.setAttribute("role", "dialog");
      root.setAttribute("aria-modal", "true");
      const h = root.querySelector("h2");
      if (h) {
        h.id = "active-dialog-title";
        root.setAttribute("aria-labelledby", h.id);
      }
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.repeat) {
        e.preventDefault();
        e.stopImmediatePropagation();
        pop();
        return;
      }
      if (e.key === "Tab" && modal) {
        const nodes = focusables(),
          at = nodes.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && at <= 0) {
          e.preventDefault();
          nodes.at(-1)?.focus();
        } else if (!e.shiftKey && at === nodes.length - 1) {
          e.preventDefault();
          nodes[0]?.focus();
        }
      }
    };
    window.addEventListener("keydown", key, true);
    let frame = 0,
      lastMove = 0;
    const controller = (now: number) => {
      frame = requestAnimationFrame(controller);
      const pad = navigator.getGamepads?.().find(Boolean);
      if (!pad) return;
      const up = pad.buttons[12]?.pressed || pad.axes[1] < -0.6,
        down = pad.buttons[13]?.pressed || pad.axes[1] > 0.6,
        left = pad.buttons[14]?.pressed || pad.axes[0] < -0.6,
        right = pad.buttons[15]?.pressed || pad.axes[0] > 0.6;
      if ((up || down || left || right) && now - lastMove > 220) {
        const nodes = focusables(),
          i = nodes.indexOf(document.activeElement as HTMLElement);
        nodes[
          (i + (up || left ? -1 : 1) + nodes.length) % nodes.length
        ]?.focus();
        lastMove = now;
      }
      const pressed = pad.buttons[0]?.pressed || pad.buttons[1]?.pressed;
      if (pressed && !padHeld.current) {
        if (pad.buttons[1]?.pressed) pop();
        else (document.activeElement as HTMLElement)?.click();
      }
      padHeld.current = !!pressed;
    };
    frame = requestAnimationFrame(controller);
    return () => {
      window.removeEventListener("keydown", key, true);
      cancelAnimationFrame(frame);
    };
  }, [top, focusKey, pop]);
  const panel =
    (
      stack.find((s) => s.kind === "panel") as
        Extract<Screen, { kind: "panel" }> | undefined
    )?.value ?? null;
  return {
    top,
    panel,
    setPanel: (value: Panel) => {
      if (value)
        returnFocus.current.set(
          "panel",
          document.activeElement as HTMLElement | null,
        );
      setStack(value ? [{ kind: "panel", value }] : []);
    },
    auth: stack.some((s) => s.kind === "auth"),
    setAuth: (v: boolean) => (v ? open({ kind: "auth" }) : remove("auth")),
    layers: stack.some((s) => s.kind === "layers"),
    setLayers: (v: boolean) =>
      v ? open({ kind: "layers" }) : remove("layers"),
    person:
      (
        stack.find((s) => s.kind === "person") as
          Extract<Screen, { kind: "person" }> | undefined
      )?.value ?? null,
    setPerson: (value: Person | null) =>
      value ? open({ kind: "person", value }) : remove("person"),
    confirmation:
      (
        stack.find((s) => s.kind === "confirmation") as
          Extract<Screen, { kind: "confirmation" }> | undefined
      )?.value ?? null,
    setConfirmation: (value: Confirmation | null) =>
      value ? open({ kind: "confirmation", value }) : remove("confirmation"),
    pop,
  };
}
