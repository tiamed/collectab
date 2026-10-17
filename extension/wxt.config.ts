import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  webExt: {
    startUrls: ['chrome://newtab'],
  },
  vite: () => ({
    plugins: [tailwindcss()],
    // Keep loro out of dep pre-bundling so the base64 entry's inlined WASM stays intact.
    optimizeDeps: {
      exclude: ['loro-crdt'],
    },
  }),
  manifest: {
    name: 'Collectab',
    description: 'A Toby-like bookmark manager with organizations, collections, and real-time sync',
    permissions: ['bookmarks', 'tabs', 'storage', 'identity'],
    // Loro CRDT compiles inlined WASM at runtime; MV3 default CSP blocks it in production.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    browser_specific_settings: {
      gecko: {
        id: 'collectab@tiamed.io',
        data_collection_permissions: {
          required: ['bookmarksInfo', 'browsingActivity', 'authenticationInfo'],
        },
      },
    },
  },
});
