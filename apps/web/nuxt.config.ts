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
    baseURL,
    head: {
      link: [
        { rel: "icon", type: "image/svg+xml", href: publicAsset("favicon.svg") },
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
    preset: "static",
    prerender: {
      routes: ["/"],
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
