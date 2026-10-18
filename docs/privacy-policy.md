# Collectab Privacy Policy

_Template. A rendered version with your operator name and contact address is served by every
Collectab server at `/privacy` (see `server/src/api/routes/privacy.ts`; keep the two in sync).
Replace the placeholders in angle brackets if you host this file elsewhere._

This policy covers the Collectab browser extension when it is connected to the server at
`<api.example.com>`, operated by `<operator name>`.

## What we collect

- **Account data**: your email address, display name and a salted bcrypt hash of your password. If
  you sign in with Google we also receive your Google account ID, name, email and profile picture URL.
- **Content you save**: spaces, collections and bookmarks (title, URL, description, favicon URL,
  tags, order) and the organizations and members you share them with.
- **Session data**: for each signed-in session, an opaque token, its expiry, and the IP address and
  user-agent that created it, used for security and to let you revoke sessions.
- **Operational logs**: request method, path, status and timing, kept for troubleshooting and abuse
  prevention.

## What we do not collect

The extension does not read page contents, track your browsing history, or send any data to analytics
or advertising services. It only reads the title, URL and favicon of the current tab when you open the
extension popup to save it. Imports read only the file you choose.

## How data is used

Data is used solely to provide the bookmark sync service: storing your collections, syncing them
between your devices, and sharing them with people you invite. It is never sold, rented or used for
advertising.

## Third parties

- **Google**: only if you choose "Continue with Google", to authenticate you.
- **Resend**: only if the operator enabled email, to deliver invitation and password-reset emails.
- **Favicon services** (DuckDuckGo, Google, icon.horse): the extension requests site icons for
  bookmarks, which sends the bookmarked site's hostname (not the full URL or any account data) to these
  services.
- The hosting provider of the server, which stores the database.

## Storage, security and retention

All traffic between the extension and the server is encrypted with HTTPS. Your session token is stored
in the extension's local storage on your device and is removed when you sign out. Data is kept until
you delete it or your account. To delete your account and all associated data, contact
`<contact email>`.

## Contact

Questions about this policy: `<contact email>`.
