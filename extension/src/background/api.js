/**
 * Client for the Batchmail backend.
 *
 * Everything here is bookkeeping — campaign state, claiming work, reporting
 * outcomes. No Gmail credentials cross this boundary; the backend never sees
 * a token and cannot send mail on the user's behalf.
 */

const BASE_URL = import.meta.env.VITE_API_BASE_URL;

// --- Auth token -----------------------------------------------------------

async function authToken() {
  const { apiToken } = await chrome.storage.local.get('apiToken');
  return apiToken ?? null;
}

/** Whether we already have a Batchmail session, without throwing. */
export async function currentToken() {
  return authToken();
}

export async function setAuthToken(token) {
  await chrome.storage.local.set({ apiToken: token });
}

export async function clearAuthToken() {
  await chrome.storage.local.remove('apiToken');
}

/**
 * Exchange an authorisation code for tokens and a Batchmail session.
 *
 * Unauthenticated by necessity — this call is what creates the session.
 * Returns { token, user, account, google: { access_token, refresh_token,
 * expires_in } }. The Gmail tokens are handed straight back to the
 * extension; the backend does not keep them.
 */
export async function exchangeCode({ code, code_verifier, redirect_uri }) {
  const res = await fetch(`${BASE_URL}/api/auth/google/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ code, code_verifier, redirect_uri }),
  });

  if (res.status === 422) {
    const { message } = await res.json();
    throw new Error(message ?? 'Google rejected the sign-in.');
  }

  if (!res.ok) throw new Error(`Sign-in failed (${res.status})`);

  return res.json();
}

/** Mint a fresh Gmail access token. The client secret lives server-side. */
export async function refreshGoogleToken(refreshToken) {
  return request('/api/auth/google/refresh', {
    method: 'POST',
    body: { refresh_token: refreshToken },
  });
}

// --- Request helper -------------------------------------------------------

async function request(path, { method = 'GET', body = null } = {}) {
  const token = await authToken();
  if (!token) throw new UnauthenticatedError();

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    await clearAuthToken();
    throw new UnauthenticatedError();
  }

  if (res.status === 422) {
    const { message, errors } = await res.json();
    throw new ValidationError(message, errors);
  }

  if (!res.ok) {
    throw new Error(`${method} ${path} failed (${res.status})`);
  }

  return res.status === 204 ? null : res.json();
}

export class UnauthenticatedError extends Error {
  constructor() {
    super('Not signed in to Batchmail');
    this.name = 'UnauthenticatedError';
  }
}

export class ValidationError extends Error {
  constructor(message, errors) {
    super(message);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

// --- Accounts -------------------------------------------------------------

export function registerAccount({ email, google_sub, display_name }) {
  return request('/api/accounts', {
    method: 'POST',
    body: { email, google_sub, display_name },
  });
}

export function removeAccount(accountId) {
  return request(`/api/accounts/${accountId}`, { method: 'DELETE' });
}

export function accountBudget(accountId) {
  return request(`/api/accounts/${accountId}/budget`);
}

/**
 * Tell the backend to stop handing out work for an account. Called when
 * Gmail returns a rate-limit error — backing off the account is the correct
 * response, not retrying the message.
 */
export function throttleAccount(accountId, { seconds, reason }) {
  return request(`/api/accounts/${accountId}/throttle`, {
    method: 'POST',
    body: { seconds, reason },
  });
}

// --- Campaigns ------------------------------------------------------------

export function campaignState(uuid) {
  return request(`/api/campaigns/${uuid}/state`);
}

/**
 * Lease a batch of recipients. The backend picks which account each one
 * sends from, based on rotation and remaining budget — that decision has to
 * be server-side so two open tabs can't both spend the same quota.
 *
 * Returns { lease_id, lease_expires_at, campaign, recipients[] }, or an
 * empty recipients array with retry_after_seconds when there's no budget.
 */
export function claim(uuid, { batch_size = 5 } = {}) {
  return request(`/api/campaigns/${uuid}/claim`, {
    method: 'POST',
    body: { batch_size },
  });
}

/**
 * Report outcomes and release the lease. Unused rows in the batch go back to
 * pending so another pass can pick them up.
 */
export function reportResults(uuid, { lease_id, results }) {
  return request(`/api/campaigns/${uuid}/results`, {
    method: 'POST',
    body: { lease_id, results },
  });
}

export function addRecipients(uuid, recipients) {
  // Chunked because a pasted CSV can be thousands of rows and PHP's
  // max_input_size will object long before the database does.
  const CHUNK = 500;
  const chunks = [];
  for (let i = 0; i < recipients.length; i += CHUNK) {
    chunks.push(recipients.slice(i, i + CHUNK));
  }

  return chunks.reduce(
    (previous, chunk) =>
      previous.then(() =>
        request(`/api/campaigns/${uuid}/recipients`, {
          method: 'POST',
          body: { recipients: chunk },
        })
      ),
    Promise.resolve()
  );
}

export function startCampaign(uuid) {
  return request(`/api/campaigns/${uuid}/start`, { method: 'POST' });
}

export function pauseCampaign(uuid) {
  return request(`/api/campaigns/${uuid}/pause`, { method: 'POST' });
}