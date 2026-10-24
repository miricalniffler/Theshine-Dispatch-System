"use client";

import { useEffect } from "react";

export const startupDiagnosticsStorageKey = "iway-mobile-startup-diagnostics-v1";

export type StartupDiagnostic = {
  at: string;
  kind: "startup" | "runtime-error" | "unhandled-rejection" | "resource-load-failure";
  detail: string;
};

function storeDiagnostic(kind: StartupDiagnostic["kind"], detail: string) {
  try {
    const current = JSON.parse(window.sessionStorage.getItem(startupDiagnosticsStorageKey) ?? "[]") as StartupDiagnostic[];
    const next = [...current, { at: new Date().toISOString(), kind, detail }].slice(-20);
    window.sessionStorage.setItem(startupDiagnosticsStorageKey, JSON.stringify(next));
  } catch {
    // Storage can be unavailable in private browsing. Diagnostics must never
    // prevent the actual application from starting.
  }
}

function errorName(value: unknown) {
  return value instanceof Error && value.name ? value.name.slice(0, 80) : "unknown";
}

/** Keeps a device-local, non-sensitive startup trail for mobile support. */
export function StartupDiagnostics() {
  useEffect(() => {
    storeDiagnostic("startup", "client listener ready");

    const onError = (event: ErrorEvent) => {
      if (event.target && event.target !== window) {
        const tagName = event.target instanceof Element ? event.target.tagName.toLowerCase() : "resource";
        storeDiagnostic("resource-load-failure", tagName);
        return;
      }
      storeDiagnostic("runtime-error", errorName(event.error));
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      storeDiagnostic("unhandled-rejection", errorName(event.reason));
    };

    window.addEventListener("error", onError, true);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError, true);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return null;
}
