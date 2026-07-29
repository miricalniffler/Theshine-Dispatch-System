import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "接送机工作台",
    short_name: "接送机工作台",
    description: "内部订单处理与车队协作工作台",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f7fb",
    theme_color: "#122a47",
    lang: "zh-CN",
    icons: [
      {
        src: "/iway-logo.png",
        sizes: "256x256",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
