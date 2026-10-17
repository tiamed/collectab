# Chrome Web Store submission checklist

## Build

```bash
cd extension
pnpm install
WXT_API_BASE_URL=https://api.example.com pnpm zip   # → .output/collectab-<version>-chrome.zip
```

Never set `WXT_EXTENSION_KEY` for a store upload. It only pins the ID of unpacked development builds.

## After the first upload

The store assigns the item ID when you first upload a draft. Then:

1. Put it in the server's `EXTENSION_IDS` (add `moz-extension://` if you also ship to Firefox) and restart.
2. If you use Google sign-in, nothing changes in Google Cloud Console. Its only redirect URI is
   `https://api.example.com/api/auth/callback/google` (see [deployment.md](deployment.md#4-optional-google-sign-in)).

## Permission justifications (Privacy practices tab)

| Permission | Justification to paste |
|---|---|
| `storage` | Stores the user's session token, chosen server URL, UI preferences and an offline cache of their bookmarks locally. |
| `activeTab` | When the user opens the toolbar popup to save a bookmark, reads the current tab's title, URL and favicon to prefill the form. No access to other tabs or browsing history. |
| `identity` | Used only when the user clicks "Continue with Google", to run the OAuth sign-in in a browser-managed window (`identity.launchWebAuthFlow`). |
| New tab override | The extension's main UI (collections dashboard) replaces the new tab page, which is its single purpose. |
| Host permissions | None requested. The API server is contacted via CORS. |
| Remote code | None. All scripts are bundled. `wasm-unsafe-eval` is needed to instantiate the bundled Loro CRDT WebAssembly module. |

**Single purpose**: "Organize and sync bookmarks into spaces and collections on a new tab page."

## Data usage disclosures

Tick: **Personally identifiable information** (email, name), **Authentication information** (password
at sign-in, session token), and **Web history** (only the URLs/titles the user explicitly saves as
bookmarks). Certify that data is not sold, not used for unrelated purposes, and not used for
creditworthiness.

## Privacy policy URL

`https://api.example.com/privacy`, served by the server. Set `PRIVACY_OPERATOR_NAME` and
`PRIVACY_CONTACT_EMAIL`. A copy for hosting elsewhere is in [privacy-policy.md](privacy-policy.md).

## Reviewer test account

Reviewers need to sign in. Either keep `INVITE_MODE=open` (anyone can register as `guest`), or create
an account for them and give the credentials in "Test instructions", for example:

> Open a new tab → Sign in → email `reviewer@example.com` / password `…`. The server URL is preconfigured.
