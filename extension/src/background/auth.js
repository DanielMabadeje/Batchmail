/**
 * Google OAuth for Batchmail.
 *
 * SPLIT OF RESPONSIBILITY
 * -----------------------
 * The extension runs the redirect and generates the PKCE pair. The backend
 * completes the token exchange, because launchWebAuthFlow redirects to
 * chromiumapp.org — which must be registered on a "Web application" OAuth
 * client — and Google requires that client's secret at the token endpoint
 * even when PKCE is used.
 *
 * The tokens come straight back here and live in chrome.storage. The backend
 * does not persist them and cannot send mail on the user's behalf.
 *
 * The alternative, chrome.identity.getAuthToken, needs no secret and lets
 * Chrome hold the credential — but it binds you to accounts signed into the
 * Chrome profile, which makes multi-account rotation impractical. Rotation
 * is the only real way past Gmail's daily caps, so we take this route.
 */

import * as api from './api.js';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'openid',
  'email',
  'profile',
].join(' ');

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

// --- PKCE -----------------------------------------------------------------

function base64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function randomVerifier() {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier)
  );
  return base64Url(digest);
}

// --- Connect --------------------------------------------------------------

/**
 * Runs consent, exchanges the code through the backend, stores the account.
 *
 * `loginHint` pre-fills the chooser — pass it when reconnecting a known
 * address so the user isn't asked which account they meant.
 */
export async function connectAccount({ loginHint = null } = {}) {
  const verifier = randomVerifier();
  const challenge = await challengeFor(verifier);
  const redirectUri = chrome.identity.getRedirectURL();

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    // Both are required to reliably get a refresh token. Without
    // prompt=consent Google returns one only on an account's very first
    // authorisation, which makes reconnect flows fail confusingly.
    access_type: 'offline',
    prompt: 'consent select_account',
  });

  if (loginHint) params.set('login_hint', loginHint);

  const responseUrl = await chrome.identity.launchWebAuthFlow({
    url: `${AUTH_ENDPOINT}?${params}`,
    interactive: true,
  });

  const returned = new URL(responseUrl);

  if (returned.searchParams.get('error')) {
    throw new Error(
      `Google denied authorisation: ${returned.searchParams.get('error')}`
    );
  }

  const code = returned.searchParams.get('code');
  if (!code) throw new Error('Google returned no authorisation code.');

  // One call: the backend exchanges the code, creates or finds the user,
  // and returns both a Batchmail session and the Gmail tokens.
  const result = await api.exchangeCode({
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
  });

  await api.setAuthToken(result.token);

  // Register the address so the backend can do quota accounting for it.
  // Without this row, claim() finds no available accounts and hands back
  // empty batches with no obvious cause.
  const registered = await api.registerAccount(result.account);

  const account = {
    backendId: registered.id,
    email: result.account.email,
    googleSub: result.account.google_sub,
    displayName: result.account.display_name,
    refreshToken: result.google.refresh_token,
    accessToken: result.google.access_token,
    expiresAt: Date.now() + result.google.expires_in * 1000,
    needsReconnect: false,
  };

  await saveAccount(account);
  return account;
}

// --- Token lifecycle ------------------------------------------------------

/**
 * A usable Gmail access token, refreshed through the backend if stale.
 *
 * Refreshes 60s early — a token that expires mid-request produces a 401 that
 * is easy to mistake for a revoked grant.
 */
export async function accessTokenFor(email) {
  const account = await getAccount(email);
  if (!account) throw new Error(`No connected account for ${email}`);

  if (account.accessToken && account.expiresAt > Date.now() + 60_000) {
    return account.accessToken;
  }

  try {
    const refreshed = await api.refreshGoogleToken(account.refreshToken);

    account.accessToken = refreshed.access_token;
    account.expiresAt = Date.now() + refreshed.expires_in * 1000;
    account.needsReconnect = false;
    await saveAccount(account);

    return account.accessToken;
  } catch (err) {
    // A dead refresh token means revoked access, a password change, or a
    // grant expired through disuse. Flag it so the UI can prompt a
    // reconnect instead of silently failing every send.
    account.needsReconnect = true;
    await saveAccount(account);
    throw new Error(`Reconnect required for ${email}: ${err.message}`);
  }
}

export async function disconnectAccount(email) {
  const account = await getAccount(email);

  if (account?.refreshToken) {
    // Best effort — revoke at Google so the grant also disappears from the
    // user's account permissions page.
    await fetch(
      `https://oauth2.googleapis.com/revoke?token=${account.refreshToken}`,
      { method: 'POST' }
    ).catch(() => {});
  }

  if (account?.backendId) {
    await api.removeAccount(account.backendId).catch(() => {});
  }

  const { accounts = {} } = await chrome.storage.local.get('accounts');
  delete accounts[email];
  await chrome.storage.local.set({ accounts });
}

// --- Storage --------------------------------------------------------------

async function saveAccount(account) {
  const { accounts = {} } = await chrome.storage.local.get('accounts');
  accounts[account.email] = account;
  await chrome.storage.local.set({ accounts });
}

async function getAccount(email) {
  const { accounts = {} } = await chrome.storage.local.get('accounts');
  return accounts[email] ?? null;
}

/** Local account list, with tokens stripped — safe to hand to the UI. */
export async function listAccounts() {
  const { accounts = {} } = await chrome.storage.local.get('accounts');

  return Object.values(accounts).map(
    ({ refreshToken, accessToken, ...rest }) => rest
  );
}