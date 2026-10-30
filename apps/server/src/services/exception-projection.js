/**
 * Owner-facing projection of an availability exception document.
 * Intentionally an allowlist: newly added internal fields can never leak.
 * @param {Record<string, unknown>} doc stored document
 * @returns {Record<string, unknown>}
 */
export function toExceptionResponse(doc) {
  return {
    id: doc._id.toString(),
    date: doc.date ?? null,
    isOpen: doc.isOpen ?? null,
    windows: doc.windows ?? [],
    staffId: doc.staffId ? doc.staffId.toString() : null,
    serviceId: doc.serviceId ? doc.serviceId.toString() : null,
    startDateTime: doc.startDateTime ? new Date(doc.startDateTime).toISOString() : null,
    endDateTime: doc.endDateTime ? new Date(doc.endDateTime).toISOString() : null,
    reason: doc.reason,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}
