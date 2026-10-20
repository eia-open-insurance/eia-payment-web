/**
 * Shared JSON transport for the payment workbench.
 *
 * Every call carries the tenant header the Payment, Document, Event, and Party
 * APIs require. Optional headers are merged in so a caller can add the
 * X-EIA-Book scope a cross-record search needs.
 */
export const TENANT = '11111111-1111-7111-8111-111111111111';

export function readJson(response) {
  return response.json().catch(() => null);
}

/**
 * Renders an RFC 7807 problem, including the field details the services put in
 * `details` or `errors`, so a validation failure is actionable in the UI.
 */
export function problemMessage(body, fallback) {
  if (!body) return fallback;
  const summary = body.message || body.detail || body.title || fallback;
  const code = typeof body.code === 'string' && body.code ? `${body.code}: ` : '';
  const issues = Array.isArray(body.details) ? body.details : Array.isArray(body.errors) ? body.errors : [];
  if (issues.length === 0) return `${code}${summary}`;
  const details = issues
    .map((issue) => `${issue.field || 'request'}: ${issue.message || issue.code || 'is invalid'}`)
    .join('; ');
  return `${code}${summary} (${details})`;
}

export async function api(path, options = {}) {
  const headers = { 'X-EIA-Tenant': TENANT, ...(options.headers || {}) };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const body = await readJson(response);
  return { response, body };
}
