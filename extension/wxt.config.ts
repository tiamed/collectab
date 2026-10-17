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
    homepage_url: 'https://github.com/tiamed/collectab',
    // activeTab: read title/URL/favicon of the current tab when the popup is opened.
    // identity: "Continue with Google" via identity.launchWebAuthFlow.
    // No host permissions: the API server is reached via CORS, so any self-hosted URL works.
    permissions: ['activeTab', 'storage', 'identity'],
    // Dev-only: pin the unpacked extension ID (and thus the OAuth redirect URL) with a
    // public key. Never set it for a Chrome Web Store upload; the store assigns the ID.
    ...(process.env.WXT_EXTENSION_KEY ? { key: process.env.WXT_EXTENSION_KEY } : {}),
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
