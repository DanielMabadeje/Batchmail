/**
 * Turn pasted spreadsheet data into recipients.
 *
 * Copying cells from Google Sheets or Excel puts TAB-separated text on the
 * clipboard, so paste already covers the "import from a spreadsheet" case
 * without asking for a Sheets scope. CSV is handled too, for people pasting
 * from a text file.
 */

/** Sniff the delimiter from the header row. Tabs win — spreadsheets use them. */
function detectDelimiter(line) {
  if (line.includes('\t')) return '\t';
  if (line.includes(';') && !line.includes(',')) return ';';
  return ',';
}

/**
 * Split one line, honouring quoted fields.
 *
 * Hand-rolled rather than pulled from a library: the input is one pasted
 * block, not a streamed file, and this avoids a dependency in a content
 * script that has to stay small.
 */
function splitLine(line, delimiter) {
  const cells = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      // A doubled quote inside a quoted field is a literal quote.
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells.map((cell) => cell.trim());
}

/** Normalise a header into something usable as {{a_merge_field}}. */
function slugify(header, index) {
  const slug = header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return slug || `column_${index + 1}`;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Find the email column.
 *
 * Header name first, then fall back to sniffing the first data row for
 * something that looks like an address — people paste headerless data, and
 * column order varies.
 */
function findEmailColumn(fields, firstRow) {
  const byName = fields.findIndex((field) =>
    ['email', 'email_address', 'e_mail', 'mail', 'address'].includes(field)
  );

  if (byName !== -1) return byName;

  return firstRow.findIndex((cell) => EMAIL_PATTERN.test(cell));
}

/**
 * @returns {{
 *   recipients: Array<{email: string, name: string|null, merge_data: object}>,
 *   fields: string[],
 *   skipped: Array<{line: number, value: string, reason: string}>,
 *   emailField: string|null,
 * }}
 */
export function parseRecipients(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { recipients: [], fields: [], skipped: [], emailField: null };
  }

  const delimiter = detectDelimiter(lines[0]);
  const headerCells = splitLine(lines[0], delimiter);

  // If the first row already contains an address, it's data, not headers.
  const hasHeaders = !headerCells.some((cell) => EMAIL_PATTERN.test(cell));

  const fields = hasHeaders
    ? headerCells.map(slugify)
    : headerCells.map((_, i) => `column_${i + 1}`);

  const dataLines = hasHeaders ? lines.slice(1) : lines;
  const firstRow = dataLines.length ? splitLine(dataLines[0], delimiter) : [];
  const emailIndex = findEmailColumn(fields, firstRow);

  if (emailIndex === -1) {
    return {
      recipients: [],
      fields,
      skipped: [],
      emailField: null,
    };
  }

  const nameIndex = fields.findIndex((field) =>
    ['name', 'full_name', 'first_name', 'firstname'].includes(field)
  );

  const recipients = [];
  const skipped = [];
  const seen = new Set();

  dataLines.forEach((line, i) => {
    const cells = splitLine(line, delimiter);
    const email = (cells[emailIndex] ?? '').toLowerCase();

    if (!EMAIL_PATTERN.test(email)) {
      skipped.push({
        line: i + (hasHeaders ? 2 : 1),
        value: cells[emailIndex] ?? '',
        reason: 'not a valid email address',
      });
      return;
    }

    // Duplicates would burn quota twice for one person. The backend's unique
    // index catches this too, but the user should see the count here.
    if (seen.has(email)) {
      skipped.push({ line: i + (hasHeaders ? 2 : 1), value: email, reason: 'duplicate' });
      return;
    }

    seen.add(email);

    const merge_data = {};
    fields.forEach((field, index) => {
      merge_data[field] = cells[index] ?? '';
    });

    recipients.push({
      email,
      name: nameIndex !== -1 ? cells[nameIndex] || null : null,
      merge_data,
    });
  });

  return { recipients, fields, skipped, emailField: fields[emailIndex] };
}

/** Merge fields referenced in a template but absent from the data. */
export function missingFields(template, fields) {
  const used = [...template.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]);
  return [...new Set(used.filter((field) => !fields.includes(field)))];
}