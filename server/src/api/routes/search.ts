import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { getDb } from '../../database/client.js';
import { authMiddleware, type AuthEnv } from '../middleware/auth.js';

export const searchRoutes = new Hono<AuthEnv>();
searchRoutes.use('*', authMiddleware);

const MAX_TERMS = 8;
const MAX_RESULTS = 200;

function likePattern(term: string) {
  return `%${term.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

type SearchRow = {
  id: string;
  collection_id: string;
  title: string;
  url: string;
  description: string | null;
  favicon: string | null;
  tags: string[] | null;
  order_index: number | null;
  created_at: string;
  updated_at: string;
  collection_name: string;
  collection_icon: string | null;
  collection_order: number | null;
  space_id: string;
  space_name: string;
  space_icon: string | null;
  space_order: number | null;
  org_id: string | null;
  org_name: string | null;
  org_icon: string | null;
};

/**
 * Substring search across every space the caller can read (same rules as
 * getEffectiveRole). ILIKE instead of tsvector so CJK titles match.
 */
searchRoutes.get('/', async (c) => {
  const db = getDb();
  const userId = c.get('userId');
  const query = (c.req.query('q') || '').trim();

  if (!query) {
    return c.json({ results: [], query: '' });
  }

  const terms = query.split(/\s+/).filter(Boolean).slice(0, MAX_TERMS);
  const haystack = sql`(b.title || ' ' || b.url || ' ' || COALESCE(b.description, '') || ' ' || COALESCE(array_to_string(b.tags, ' '), ''))`;
  const termConditions = sql.join(
    terms.map((t) => sql`${haystack} ILIKE ${likePattern(t)}`),
    sql` AND `,
  );

  const result = await db.execute(sql`
    SELECT b.id, b.collection_id, b.title, b.url, b.description, b.favicon, b.tags,
           b.order_index, b.created_at, b.updated_at,
           c.name AS collection_name, c.icon AS collection_icon, c.order_index AS collection_order,
           s.id AS space_id, s.name AS space_name, s.icon AS space_icon, s.order_index AS space_order,
           s.org_id, o.name AS org_name, o.icon AS org_icon
    FROM bookmarks b
    JOIN collections c ON c.id = b.collection_id
    JOIN spaces s ON s.id = c.space_id
    LEFT JOIN organizations o ON o.id = s.org_id
    WHERE (
        s.owner_id = ${userId}
        OR o.owner_id = ${userId}
        OR EXISTS (
          SELECT 1 FROM space_members sm
          WHERE sm.space_id = s.id AND sm.user_id = ${userId}
        )
      )
      AND ${termConditions}
    ORDER BY (b.title ILIKE ${likePattern(query)}) DESC,
             s.order_index, c.order_index, b.order_index
    LIMIT ${MAX_RESULTS}
  `);

  const rows = result.rows as unknown as SearchRow[];
  const results = rows.map((r) => ({
    bookmark: {
      id: r.id,
      collectionId: r.collection_id,
      title: r.title,
      url: r.url,
      description: r.description,
      favicon: r.favicon,
      tags: r.tags ?? [],
      orderIndex: r.order_index ?? 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    },
    collection: {
      id: r.collection_id,
      name: r.collection_name,
      icon: r.collection_icon,
      orderIndex: r.collection_order ?? 0,
    },
    space: {
      id: r.space_id,
      name: r.space_name,
      icon: r.space_icon,
      orgId: r.org_id,
      orderIndex: r.space_order ?? 0,
    },
    org: r.org_id ? { id: r.org_id, name: r.org_name ?? '', icon: r.org_icon } : null,
  }));

  return c.json({ results, query, truncated: rows.length >= MAX_RESULTS });
});
