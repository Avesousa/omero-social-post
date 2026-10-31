// Token names mirrored from app/globals.css, for components that iterate over them.
// Status and network ids match the API contract; switch to the @omero/shared exports
// once that package publishes them.

export const POST_STATUSES = [
  'draft',
  'scheduled',
  'publishing',
  'published',
  'partially_published',
  'failed',
  'missed',
] as const;

export type PostStatus = (typeof POST_STATUSES)[number];

export const NETWORKS = ['x', 'linkedin', 'instagram', 'facebook'] as const;

export type Network = (typeof NETWORKS)[number];

/** Networks available in stage 1; the rest are placeholders for later stages. */
export const ACTIVE_NETWORKS: readonly Network[] = ['x', 'linkedin'];

export const BRAND_COLORS = ['espresso', 'roast', 'lagoon', 'crema', 'berry', 'iris'] as const;

export type BrandColor = (typeof BRAND_COLORS)[number];

export const SEMANTIC_COLORS = ['success', 'warning', 'danger', 'info'] as const;

export type SemanticColor = (typeof SEMANTIC_COLORS)[number];
