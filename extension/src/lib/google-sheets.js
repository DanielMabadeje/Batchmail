/**
 * Import recipients from a Google Sheets link.
 *
 * The fetched rows are converted back into tab-separated text and handed to
 * the same parser the paste box uses. One code path for both import methods
 * means merge-field detection, deduplication, and validation behave
 * identically however the data arrived.
 */

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

/**
 * Pull the spreadsheet id and tab out of a Sheets URL.
 *
 * Handles the usual shapes:
 *   .../spreadsheets/d/<id>/edit#gid=0
 *   .../spreadsheets/d/<id>/edit?gid=123456
 *   .../spreadsheets/d/<id>
 */
export function parseSheetUrl(url) {
  const id = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1];

  if (!id) {
    throw new Error(
      "That doesn't look like a Google Sheets link. Copy the URL from the browser bar."
    );
  }

  // gid appears in the hash on older links and the query string on newer ones.
  const gid =
    url.match(/[#&?]gid=(\d+)/)?.[1] ?? null;

  return { id, gid };
}

async function api(path, token) {
  const res = await fetch(`${SHEETS_API}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.ok) return res.json();

  const detail = await res.json().catch(() => ({}));
  const message = detail?.error?.message ?? '';
  const reason = detail?.error?.details?.[0]?.reason ?? detail?.error?.status ?? '';

  // Google returns 403 for several unrelated problems and the distinction
  // matters a lot for a self-hosted app, where the user controls the Cloud
  // project. Never collapse these into one message.
  if (res.status === 403) {
    if (/has not been used in project|is disabled/i.test(message)) {
      throw new Error(
        'The Google Sheets API is not enabled in your Google Cloud project. ' +
          'Enable it under APIs & Services, wait a minute, then try again.'
      );
    }

    if (/insufficient|scope/i.test(message) || reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT') {
      throw new Error(
        'Batchmail has not been granted access to your spreadsheets. ' +
          'Disconnect and reconnect the account, and accept the Sheets permission.'
      );
    }

    throw new Error(`No access to that spreadsheet: ${message}`);
  }

  if (res.status === 401) {
    throw new Error('Google rejected the token. Reconnect the account and try again.');
  }

  if (res.status === 404) {
    throw new Error('That spreadsheet does not exist, or the link is wrong.');
  }

  throw new Error(message || `Sheets API error (${res.status})`);
}

/**
 * Resolve which tab to read.
 *
 * A gid identifies a tab but the values endpoint wants its title, so the
 * metadata call is unavoidable. Without a gid we take the first tab, which
 * is what someone pasting a bare spreadsheet link expects.
 */
async function resolveSheetTitle(id, gid, token) {
  const meta = await api(
    `${id}?fields=sheets.properties(sheetId,title)`,
    token
  );

  const sheets = meta.sheets ?? [];
  if (sheets.length === 0) throw new Error('That spreadsheet has no tabs.');

  if (gid) {
    const match = sheets.find((s) => String(s.properties.sheetId) === gid);
    if (match) return match.properties.title;
  }

  return sheets[0].properties.title;
}

/**
 * Fetch a sheet and return it as tab-separated text.
 *
 * @returns {Promise<{ text: string, sheetTitle: string, rowCount: number }>}
 */
export async function fetchSheetAsText(url, token) {
  const { id, gid } = parseSheetUrl(url);
  const title = await resolveSheetTitle(id, gid, token);

  // Generous but bounded. Someone importing more than 5000 rows is well past
  // what Gmail's daily caps can send anyway.
  const range = encodeURIComponent(`${title}!A1:ZZ5000`);
  const data = await api(`${id}/values/${range}`, token);

  const rows = data.values ?? [];
  if (rows.length === 0) throw new Error('That tab is empty.');

  // Rows come back ragged — Sheets omits trailing empty cells — so pad to the
  // widest row or columns shift left and merge fields land on wrong values.
  const width = Math.max(...rows.map((r) => r.length));

  const text = rows
    .map((row) => {
      const padded = [...row, ...Array(width - row.length).fill('')];
      // Tabs and newlines inside a cell would corrupt the TSV the parser
      // reads, and neither is meaningful in a merge field.
      return padded.map((cell) => String(cell ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t');
    })
    .join('\n');

  return { text, sheetTitle: title, rowCount: rows.length - 1 };
}