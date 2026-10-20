/**
 * Linked-document helpers.
 *
 * A document is evidence attached to a business record: it may point at a
 * payment, but the payment stays owned by the Payment domain and a document
 * never changes its amount, approval path, or status. The Document API list
 * accepts the `linkedType` + `linkedId` pair and returns either a bare array or
 * an `{ items }` page, so callers normalize both shapes.
 */
export const PAYMENT_LINKED_TYPE = 'PAYMENT';

/** Builds GET /api/v1/documents?linkedType=…&linkedId=… for one record. */
export function linkedDocumentsEndpoint(linkedType, linkedId) {
  const type = String(linkedType || '').trim().toUpperCase();
  const id = String(linkedId || '').trim();
  if (!type || !id) return '';
  return `/api/v1/documents?linkedType=${encodeURIComponent(type)}&linkedId=${encodeURIComponent(id)}`;
}

/** Accepts either a bare array or the `{ items }` list projection. */
export function linkedDocuments(payload) {
  if (Array.isArray(payload)) return payload;
  return payload && Array.isArray(payload.items) ? payload.items : [];
}

export function documentRecordId(document) {
  return String((document && (document.id || document.documentId)) || '').trim();
}

/** Shell route that opens the document workbench on this record. */
export function documentHref(document) {
  const id = documentRecordId(document);
  return id ? `/document?record=${encodeURIComponent(id)}` : '';
}

export function documentNumber(document) {
  return String((document && (document.documentNumber || document.number)) || '').trim();
}

export function documentTitle(document) {
  return String((document && document.title) || '').trim();
}

export function documentType(document) {
  return String((document && (document.documentType || document.type)) || '').trim();
}

export function documentStatus(document) {
  return String((document && document.status) || '').trim();
}
