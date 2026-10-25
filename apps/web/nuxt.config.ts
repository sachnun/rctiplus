import tailwindcss from "@tailwindcss/vite";

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
        { rel: "icon", type: "image/svg+xml", href: "favicon.svg" },
        { rel: "apple-touch-icon", sizes: "180x180", href: "apple-touch-icon.png" },
      ],
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
