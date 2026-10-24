"use client";

import { useEffect } from "react";

/** Registers the compatibility worker. It deliberately does not cache app code. */
export function PwaRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // 开发期间不启用离线缓存：它会把刚修改的前端脚本留在浏览器里，
    // 造成“页面看起来更新了，但按钮没有反应”的假象。
    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker.getRegistrations().then((registrations) =>
        Promise.all(registrations.map((registration) => registration.unregister())),
      );
      return;
    }

    if (!window.isSecureContext) return;
    // This worker must be retrievable before login. If it were protected by
    // the app proxy, an old root-scoped worker on Safari could remain in
    // control indefinitely and continue intercepting even diagnostic routes.
    // A changed script URL also forces an update check for registrations made
    // by releases before the compatibility worker existed.
    void navigator.serviceWorker.register("/service-worker.js?rev=compat-v2", { scope: "/", updateViaCache: "none" }).then((registration) =>
      registration.update(),
    ).catch(() => {
      // The site remains fully usable online if installation support is unavailable.
    });
  }, []);

  return null;
}
