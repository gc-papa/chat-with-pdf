// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2024-07-30',
  // https://nuxt.com/docs/getting-started/upgrade#testing-nuxt-4
  future: { compatibilityVersion: 4 },

  // https://nuxt.com/modules
  modules: ['@nuxt/eslint', '@nuxt/ui', '@nuxtjs/mdc', '@vueuse/nuxt'],

  nitro: {
    preset: process.env.LOCAL === 'true' ? 'node' : 'cloudflare-pages',
    experimental: {
      openAPI: true,
    },
  },

  // https://eslint.nuxt.com
  eslint: {
    config: {
      stylistic: {
        quotes: 'single',
      },
    },
  },

  // https://devtools.nuxt.com
  devtools: { enabled: true },
})
