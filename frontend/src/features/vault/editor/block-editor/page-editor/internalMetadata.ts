export const INTERNAL_METADATA_KEYS = Object.freeze([
  'title', 'table_id', 'database_id', 'database_table_id', 'id',
  'parent_id', 'source_id', 'resolved_table_id', 'last_modified',
  'created_time', 'last_edited_time', 'source_parent_id',
  // Authorship/timestamp stamps written by the backend (_stamp_author) on
  // every create/save — system metadata, never user fields.
  'created_by', 'created_at', 'last_edited_by', 'last_edited_at',
  'is_default_template', 'is_template', 'path', 'filename',
  'cover', 'cover_manual', 'icon',
]);
export const INTERNAL_METADATA_KEY_SET = new Set(INTERNAL_METADATA_KEYS);
