import type { InviteRow } from '../../auth/invites.js';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

/**
 * Invite links land here instead of better-invite's cookie redirect: the
 * extension signs up with a bearer token and never sees server cookies, so
 * the code has to be carried over by the user.
 */
export function inviteLandingHtml(opts: {
  code: string;
  serverUrl: string;
  installUrl?: string;
  invite: InviteRow | null;
  error: string | null;
}): string {
  const code = escapeHtml(opts.code);
  const server = escapeHtml(opts.serverUrl);
  const install = opts.installUrl
    ? `<a href="${escapeHtml(opts.installUrl)}" target="_blank" rel="noreferrer">Install the Collectab extension</a>`
    : 'Install the Collectab browser extension';

  const body = opts.invite
    ? `<h1>You're invited to Collectab</h1>
<p>This invite gives you the <strong>${escapeHtml(opts.invite.role)}</strong> role.
Valid until ${escapeHtml(opts.invite.expiresAt.toISOString().slice(0, 10))}.</p>
<ol>
  <li>${install}.</li>
  <li>Open a new tab and click <strong>Sign in</strong>, then <strong>Sign up</strong>.</li>
  <li>Under <strong>Server URL</strong>, make sure it is <code>${server}</code>.</li>
  <li>Paste this invite code:</li>
</ol>
<div class="code"><code id="code">${code}</code><button type="button" id="copy">Copy</button></div>
<p class="muted">Already have an account on this server? Sign in, then paste the code under Settings → Account → Redeem invite.</p>`
    : `<h1>Invite not available</h1><p>${escapeHtml(opts.error ?? 'This invite is not valid.')}</p><p class="muted">Ask the person who invited you for a new link.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Collectab invite</title>
<style>
  body { font: 15px/1.6 system-ui, sans-serif; max-width: 34rem; margin: 3rem auto; padding: 0 1rem; color: #222; }
  h1 { font-size: 1.5rem; } .muted { color: #777; font-size: .9em; }
  code { background: #f3f3f3; padding: 0 .25em; border-radius: 3px; }
  .code { display: flex; gap: .5rem; align-items: center; margin: 1rem 0; }
  .code code { font-size: 1.15rem; padding: .4rem .6rem; letter-spacing: .03em; }
  button { font: inherit; padding: .35rem .8rem; border-radius: 4px; border: 1px solid #9761da; background: #9761da; color: #fff; cursor: pointer; }
  @media (prefers-color-scheme: dark) { body { background: #111; color: #ddd; } code { background: #222; } a { color: #8ab4f8; } }
</style>
</head>
<body>
${body}
<script>
  const btn = document.getElementById('copy');
  if (btn) btn.addEventListener('click', async () => {
    await navigator.clipboard.writeText(document.getElementById('code').textContent);
    btn.textContent = 'Copied';
  });
</script>
</body>
</html>`;
}
