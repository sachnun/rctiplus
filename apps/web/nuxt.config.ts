import tailwindcss from "@tailwindcss/vite";

const baseURL = process.env.NUXT_APP_BASE_URL || "/";
const publicAsset = (path: string) => `${baseURL.replace(/\/+$/, "")}/${path}`;

export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  ssr: false,
  sourcemap: false,
  devtools: { enabled: process.env.NODE_ENV !== "production" },
  css: ["~/assets/css/main.css"],
  components: [{ path: "~/components", pathPrefix: false }],
  app: {
    head: {
      link: [
        { rel: "icon", type: "image/svg+xml", href: publicAsset("favicon.svg") },
        {
          rel: "icon",
          type: "image/x-icon",
          sizes: "16x16 32x32 48x48",
          href: publicAsset("favicon.ico"),
        },
        {
          rel: "apple-touch-icon",
          sizes: "180x180",
          href: publicAsset("apple-touch-icon.png"),
        },
      ],
    },
  },
  runtimeConfig: {
    public: {
      apiBase: "",
    },
  },
  nitro: {
    prerender: {
      routes: ["/", "/404.html"],
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
