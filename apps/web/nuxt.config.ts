import tailwindcss from "@tailwindcss/vite";

export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  ssr: false,
  sourcemap: false,
  devtools: { enabled: process.env.NODE_ENV !== "production" },
  css: ["~/assets/css/main.css"],
  components: [{ path: "~/components", pathPrefix: false }],
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
