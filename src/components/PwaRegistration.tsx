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
    void navigator.serviceWorker.register("/service-worker.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // The site remains fully usable online if installation support is unavailable.
    });
  }, []);

  return null;
}
