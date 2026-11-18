// hooks/useDevice.js
//
// One shared, provider-free device store. Any component can call useDevice().
//
// It detects: screen size class, orientation, touch vs mouse, iOS/Android,
// installed-PWA mode, on-screen keyboard, online/offline, reduced motion.
//
// It also writes the result onto <html> so CSS can react without JS:
//   data-device="phone|tablet|laptop|desktop"
//   data-orientation="portrait|landscape"
//   data-touch="true|false"   data-os="ios|android|desktop"
//   data-standalone="true|false"   data-keyboard="open|closed"
//   --app-height: <real visible height in px>   (fixes mobile URL-bar jumps)
//
// Breakpoints match main.css: drawer sidebar below 992px.
//
// Call initDevice() once in main.jsx (before render) so the <html>
// attributes also exist on the login page:   import { initDevice } from "./hooks/useDevice";

import { useSyncExternalStore } from "react";

export const BREAKPOINTS = { phone: 768, wide: 992, large: 1600 };

const isBrowser = typeof window !== "undefined";
const listeners = new Set();
let keyboardOpen = false;
let state = null;
let started = false;
let raf = 0;

const media = (q) => (isBrowser && window.matchMedia ? window.matchMedia(q).matches : false);

function compute() {
  const width = window.innerWidth;
  const height = window.visualViewport?.height
    ? Math.round(window.visualViewport.height)
    : window.innerHeight;
  const ua = navigator.userAgent || "";

  // iPadOS reports itself as a Mac, so also check for touch points.
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);

  const breakpoint =
    width < BREAKPOINTS.phone ? "phone"
    : width < BREAKPOINTS.wide ? "tablet"
    : width < BREAKPOINTS.large ? "laptop"
    : "desktop";

  const landscape = width > window.innerHeight;

  return {
    width,
    height,
    breakpoint,
    isPhone: width < BREAKPOINTS.phone,
    isTablet: width >= BREAKPOINTS.phone && width < BREAKPOINTS.wide,
    isWide: width >= BREAKPOINTS.wide,          // sidebar is docked (not a drawer)
    isLargeScreen: width >= BREAKPOINTS.large,
    isTouch: media("(pointer: coarse)"),
    isLandscape: landscape,
    orientation: landscape ? "landscape" : "portrait",
    isIOS,
    isAndroid,
    os: isIOS ? "ios" : isAndroid ? "android" : "desktop",
    isStandalone: media("(display-mode: standalone)") || navigator.standalone === true,
    reducedMotion: media("(prefers-reduced-motion: reduce)"),
    keyboardOpen,
    isOnline: navigator.onLine,
  };
}

function shallowEqual(a, b) {
  if (!a || !b) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => a[k] === b[k]);
}

function applyToDocument(s) {
  const root = document.documentElement;
  root.dataset.device = s.breakpoint;
  root.dataset.orientation = s.orientation;
  root.dataset.touch = String(s.isTouch);
  root.dataset.os = s.os;
  root.dataset.standalone = String(s.isStandalone);
  root.dataset.keyboard = s.keyboardOpen ? "open" : "closed";
  root.style.setProperty("--app-height", `${s.height}px`);
}

function refresh() {
  const next = compute();
  if (shallowEqual(state, next)) return;
  state = next;
  applyToDocument(state);
  listeners.forEach((l) => l());
}

function schedule() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    refresh();
  });
}

const EDITABLE = "input, textarea, select, [contenteditable='true']";
const NON_TEXT_INPUT = /^(checkbox|radio|button|submit|reset|file|range|color|image)$/i;

function isTextField(el) {
  if (!el || !el.matches || !el.matches(EDITABLE)) return false;
  return !(el.tagName === "INPUT" && NON_TEXT_INPUT.test(el.type));
}

function onFocusIn(e) {
  if (!media("(pointer: coarse)") || !isTextField(e.target)) return;
  if (!keyboardOpen) {
    keyboardOpen = true;
    schedule();
  }
}

function onFocusOut() {
  // Wait a beat: focus often jumps from one field straight to another.
  setTimeout(() => {
    if (keyboardOpen && !isTextField(document.activeElement)) {
      keyboardOpen = false;
      schedule();
    }
  }, 120);
}

export function initDevice() {
  if (!isBrowser || started) return;
  started = true;
  state = compute();
  applyToDocument(state);

  window.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("orientationchange", schedule, { passive: true });
  window.addEventListener("online", schedule);
  window.addEventListener("offline", schedule);
  window.visualViewport?.addEventListener("resize", schedule, { passive: true });
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);
  window.matchMedia?.("(display-mode: standalone)").addEventListener?.("change", schedule);
}

function subscribe(listener) {
  initDevice();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  if (!state && isBrowser) initDevice();
  return state;
}

const SERVER_SNAPSHOT = {
  width: 1280, height: 800, breakpoint: "laptop",
  isPhone: false, isTablet: false, isWide: true, isLargeScreen: false,
  isTouch: false, isLandscape: true, orientation: "landscape",
  isIOS: false, isAndroid: false, os: "desktop",
  isStandalone: false, reducedMotion: false, keyboardOpen: false, isOnline: true,
};

export function useDevice() {
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT);
}

export default useDevice;

if (isBrowser) initDevice();