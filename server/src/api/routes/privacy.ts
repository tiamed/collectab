import type { Env } from '../../config/env.js';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

/**
 * Served at /privacy so every deployment has a privacy-policy URL to put in
 * the Chrome Web Store listing. Keep in sync with docs/privacy-policy.md.
 */
export function privacyPolicyHtml(env: Pick<Env, 'BETTER_AUTH_URL' | 'PRIVACY_CONTACT_EMAIL' | 'PRIVACY_OPERATOR_NAME' | 'OAUTH_GOOGLE_CLIENT_ID' | 'RESEND_API_KEY'>): string {
  const operator = escapeHtml(env.PRIVACY_OPERATOR_NAME || 'the operator of this Collectab server');
  const host = escapeHtml(new URL(env.BETTER_AUTH_URL).host);
  const contact = env.PRIVACY_CONTACT_EMAIL
    ? `<a href="mailto:${escapeHtml(env.PRIVACY_CONTACT_EMAIL)}">${escapeHtml(env.PRIVACY_CONTACT_EMAIL)}</a>`
    : 'the contact address listed on the Chrome Web Store page';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Collectab Privacy Policy</title>
<style>
  body { font: 15px/1.6 system-ui, sans-serif; max-width: 46rem; margin: 2rem auto; padding: 0 1rem; color: #222; }
  h1 { font-size: 1.6rem; } h2 { font-size: 1.15rem; margin-top: 1.8rem; }
  code { background: #f3f3f3; padding: 0 .25em; border-radius: 3px; }
  @media (prefers-color-scheme: dark) { body { background: #111; color: #ddd; } code { background: #222; } a { color: #8ab4f8; } }
</style>
</head>
<body>
<h1>Collectab Privacy Policy</h1>
<p>This policy covers the Collectab browser extension when it is connected to the server at <code>${host}</code>, operated by ${operator}.</p>

<h2>What we collect</h2>
<ul>
  <li><strong>Account data:</strong> your email address, display name and a salted bcrypt hash of your password${env.OAUTH_GOOGLE_CLIENT_ID ? '. If you sign in with Google we also receive your Google account ID, name, email and profile picture URL' : ''}.</li>
  <li><strong>Content you save:</strong> spaces, collections and bookmarks (title, URL, description, favicon URL, tags, order) and the organizations/members you share them with.</li>
  <li><strong>Session data:</strong> for each signed-in session, an opaque token, its expiry, and the IP address and user-agent that created it, used for security and to let you revoke sessions.</li>
  <li><strong>Operational logs:</strong> request method, path, status and timing, kept for troubleshooting and abuse prevention.</li>
</ul>

<h2>What we do not collect</h2>
<p>The extension does not read page contents, track your browsing history, or send any data to analytics or advertising services. It only reads the title, URL and favicon of a tab when you explicitly save it, and reads your browser bookmarks only when you explicitly import them.</p>

<h2>How data is used</h2>
<p>Data is used solely to provide the bookmark sync service: storing your collections, syncing them between your devices, and sharing them with people you invite. It is never sold, rented or used for advertising.</p>

<h2>Third parties</h2>
<ul>
  ${env.OAUTH_GOOGLE_CLIENT_ID ? '<li><strong>Google</strong> - only if you choose "Continue with Google", to authenticate you.</li>' : ''}
  ${env.RESEND_API_KEY ? '<li><strong>Resend</strong> - to deliver invitation and password-reset emails to your address.</li>' : ''}
  <li>The hosting provider of this server, which stores the database.</li>
</ul>

<h2>Storage, security and retention</h2>
<p>All traffic between the extension and the server is encrypted with HTTPS. Your session token is stored in the extension's local storage on your device and is removed when you sign out. Data is kept until you delete it or your account. To delete your account and all associated data, contact ${contact}.</p>

<h2>Contact</h2>
<p>Questions about this policy: ${contact}.</p>
</body>
</html>`;
}
