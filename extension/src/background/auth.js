/**
 * Google OAuth for Batchmail.
 *
 * WHY launchWebAuthFlow AND NOT getAuthToken
 * ------------------------------------------
 * chrome.identity.getAuthToken is simpler and has a real advantage: Chrome
 * holds the credential, so we never see a refresh token at all. But it binds
 * you to the accounts signed into the Chrome profile, which makes the
 * multi-account rotation story — the only way past Gmail's daily caps —
 * awkward to impossible.
 *
 * launchWebAuthFlow with PKCE lets the user connect any number of Gmail
 * accounts independently of their Chrome profile. The cost is that we hold
 * the refresh token in chrome.storage. That is still local to the user's
 * machine and never reaches the Batchmail server, which is the property that
 * matters.
 *
 * SETUP
 * -----
 * Create the OAuth client in Google Cloud as type "Chrome Extension" — that
 * type issues no client secret, which is what makes PKCE from the extension
 * safe. A "Web application" client would require a secret and force the code
 * exchange through the backend.
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
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

// --- PKCE helpers ---------------------------------------------------------

function base64UrlEncode(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function randomVerifier() {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier)
  );
  return base64UrlEncode(digest);
}

// --- Connect a new account ------------------------------------------------

/**
 * Runs the interactive consent flow and returns a stored account record.
 *
 * `loginHint` pre-fills the account chooser. Pass it when reconnecting a
 * known address so the user isn't asked which account they meant.
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
    // Required to get a refresh token back. Without prompt=consent Google
    // returns one only on the very first authorisation for that account,
    // which makes reconnect flows fail confusingly.
    access_type: 'offline',
    prompt: 'consent select_account',
  });

  if (loginHint) params.set('login_hint', loginHint);

  const responseUrl = await chrome.identity.launchWebAuthFlow({
    url: `${AUTH_ENDPOINT}?${params}`,
    interactive: true,
  });

  const returned = new URL(responseUrl);
  const error = returned.searchParams.get('error');
  if (error) throw new Error(`Google denied authorisation: ${error}`);

  const code = returned.searchParams.get('code');
  if (!code) throw new Error('No authorisation code returned');

  const tokens = await exchange({
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
  });

  const profile = decodeIdToken(tokens.id_token);

  const account = {
    email: profile.email,
    googleSub: profile.sub,
    displayName: profile.name ?? profile.email,
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };

  // Sign in to Batchmail with the same consent, if we aren't already. One
  // Google authorisation covers both identity and gmail.send.
  const token = await api.currentToken();
  if (!token) {
    await api.signIn(tokens.id_token);
  }

  // The backend needs a row for this address or claim() will find no
  // available accounts and hand back empty batches with no obvious cause.
  const registered = await api.registerAccount(account);
  account.backendId = registered.id;

  await saveAccount(account);
  return account;
}

// --- Token lifecycle ------------------------------------------------------

async function exchange(body) {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...body }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${detail}`);
  }

  return res.json();
}

/**
 * Returns a usable access token for an account, refreshing if needed.
 *
 * Refresh 60s early — a token that expires mid-request produces a 401 that
 * is easy to mistake for a revoked grant.
 */
export async function accessTokenFor(email) {
  const account = await getAccount(email);
  if (!account) throw new Error(`No connected account for ${email}`);

  if (account.accessToken && account.expiresAt > Date.now() + 60_000) {
    return account.accessToken;
  }

  try {
    const tokens = await exchange({
      grant_type: 'refresh_token',
      refresh_token: account.refreshToken,
    });

    account.accessToken = tokens.access_token;
    account.expiresAt = Date.now() + tokens.expires_in * 1000;
    await saveAccount(account);

    return account.accessToken;
  } catch (err) {
    // A dead refresh token means the user revoked access, changed their
    // password, or the grant expired through disuse. Mark it so the UI can
    // prompt a reconnect rather than silently failing every send.
    account.needsReconnect = true;
    await saveAccount(account);
    throw new Error(`Reconnect required for ${email}: ${err.message}`);
  }
}

export async function disconnectAccount(email) {
  const account = await getAccount(email);
  if (account?.refreshToken) {
    // Best effort — revoke server-side so the grant disappears from the
    // user's Google account permissions page too.
    await fetch(
      `https://oauth2.googleapis.com/revoke?token=${account.refreshToken}`,
      { method: 'POST' }
    ).catch(() => {});
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

export async function listAccounts() {
  const { accounts = {} } = await chrome.storage.local.get('accounts');
  return Object.values(accounts).map(({ refreshToken, accessToken, ...rest }) => rest);
}

// --- Utilities ------------------------------------------------------------

function decodeIdToken(idToken) {
  // Signature verification is unnecessary here: the token came directly from
  // Google's token endpoint over TLS, not from an untrusted redirect.
  const payload = idToken.split('.')[1];
  const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(json);
}