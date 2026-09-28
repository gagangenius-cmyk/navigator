import crypto from 'crypto';

// content_hash for crm_message_template_versions - a stable hash of the
// parts of a version that define its actual content (not metadata like
// createdBy/createdAt), used for change detection and to let a UI warn
// "this draft is identical to the last version" before creating a no-op one.
export function templateVersionContentHash(components: unknown, designJson?: unknown): string {
  const payload = JSON.stringify({ components, designJson: designJson ?? null });
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}
