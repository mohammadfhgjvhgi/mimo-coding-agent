// MiMo AI — Knowledge Graph
// Entity & relation extraction via the Model Gateway (structured output),
// persisted to the Entity / Relation tables, with a small BFS subgraph query.


// ============ Types ============

export interface ExtractedEntity {
  name: string
  type: string // person|place|org|concept|date|other
}

export interface ExtractedRelation {
  source: string
  target: string
  type: string // related_to|part_of|created_by|mentions|...
}

export interface GraphQueryResult {
  entities: Array<{
    id: string
    name: string
    type: string
    docId: string | null
  }>
  relations: Array<{
    id: string
    source: string
    target: string
    type: string
    weight: number
  }>
}

// ============ Extraction prompts ============

const ENTITY_SCHEMA = `{
  "entities": [
    { "name": string, "type": "person" | "place" | "org" | "concept" | "date" | "other" }
  ]
}`

const RELATION_SCHEMA = `{
  "relations": [
    { "source": string, "target": string, "type": "related_to" | "part_of" | "created_by" | "mentions" | "located_in" | "works_at" | "memberof" | "other" }
  ]
}`

function truncate(text: string, max = 6000): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

// ============ Public API ============

/**
 * Extract named entities from text using the Model Gateway's structured
 * output mode.
 */
export async function extractEntities(
  text: string,
): Promise<ExtractedEntity[]> {
  const gateway = await getModelGateway()

  const req: ModelRequest = {
    system:
      'You are an information-extraction engine. Extract named entities from the user text. ' +
      'Return only valid JSON. Be conservative: include only entities explicitly mentioned.',
    messages: [
      {
        role: 'user',
        content:
          'Extract entities as JSON array: [{name, type}]. ' +
          'Types: person, place, org, concept, date, other.\n\n' +
          `Text:\n${truncate(text)}`,
      },
    ],
    temperature: 0,
  }

  try {
    const parsed = await gateway.generateStructured<{
      entities?: ExtractedEntity[]
    }>(req, ENTITY_SCHEMA)

    const entities = Array.isArray(parsed?.entities) ? parsed.entities : []
    return entities
      .filter(e => e && typeof e.name === 'string' && typeof e.type === 'string')
      .map(e => ({
        name: e.name.trim(),
        type: (e.type || 'other').toLowerCase(),
      }))
      .filter(e => e.name.length > 0)
  } catch (err) {
    logger.warn('extractEntities failed', { error: String(err) })
    return []
  }
}

/**
 * Extract relationships between known entities from text.
 */
export async function extractRelations(
  text: string,
  entities: ExtractedEntity[],
): Promise<ExtractedRelation[]> {
  if (entities.length === 0) return []

  const gateway = await getModelGateway()
  const entityList = entities.map(e => `${e.name} (${e.type})`).join(', ')

  const req: ModelRequest = {
    system:
      'You are an information-extraction engine. Extract relationships between the entities already identified in the text. ' +
      'Both source and target MUST be exact entity names from the provided list. ' +
      'Return only valid JSON.',
    messages: [
      {
        role: 'user',
        content:
          'Extract relationships between entities as JSON array: ' +
          '[{source, target, type}]. Types: related_to, part_of, created_by, mentions, located_in, works_at, memberof, other.\n\n' +
          `Entities: ${entityList}\n\n` +
          `Text:\n${truncate(text)}`,
      },
    ],
    temperature: 0,
  }

  try {
    const parsed = await gateway.generateStructured<{
      relations?: ExtractedRelation[]
    }>(req, RELATION_SCHEMA)

    const relations = Array.isArray(parsed?.relations) ? parsed.relations : []
    const validNames = new Set(entities.map(e => e.name))
    return relations
      .filter(
        r =>
          r &&
          typeof r.source === 'string' &&
          typeof r.target === 'string' &&
          typeof r.type === 'string',
      )
      .filter(r => validNames.has(r.source) && validNames.has(r.target))
      .map(r => ({
        source: r.source,
        target: r.target,
        type: (r.type || 'related_to').toLowerCase(),
      }))
  } catch (err) {
    logger.warn('extractRelations failed', { error: String(err) })
    return []
  }
}

/**
 * Build the knowledge graph for a document: extract entities & relations,
 * persist them linked to the docId.
 *
 * Entity table has @@unique([name, type]); we upsert so the same entity
 * discovered in multiple docs converges to one row. The docId on the entity
 * row is set on first discovery and left untouched on later upserts (the
 * Relation rows below still carry docId-less links through their endpoints).
 */
export async function buildGraph(
  docId: string,
  content: string,
): Promise<void> {
  const doc = await db.knowledgeDoc.findUnique({
    where: { id: docId },
    select: { id: true, title: true },
  })
  if (!doc) {
    throw new Error(`buildGraph: doc ${docId} not found`)
  }

  logger.info('Building knowledge graph', { docId, title: doc.title })

  const entities = await extractEntities(content)
  if (entities.length === 0) {
    logger.info('No entities extracted', { docId })
    return
  }

  // Upsert entities. On conflict (name+type), keep the first docId we saw.
  const entityRowIds = new Map<string, string>()
  for (const e of entities) {
    const row = await db.entity.upsert({
      where: { name_type: { name: e.name, type: e.type } },
      update: {},
      create: {
        name: e.name,
        type: e.type,
        docId,
        metadata: JSON.stringify({ firstSeenIn: docId }),
      },
      select: { id: true },
    })
    entityRowIds.set(`${e.name}|${e.type}`, row.id)
  }

  const relations = await extractRelations(content, entities)
  if (relations.length === 0) {
    logger.info('No relations extracted', { docId, entities: entities.length })
    return
  }

  // Resolve relation endpoints to entity IDs.
  const nameToId = new Map<string, string>()
  for (const e of entities) {
    const id = entityRowIds.get(`${e.name}|${e.type}`)
    if (id) nameToId.set(e.name, id)
  }

  let created = 0
  for (const r of relations) {
    const sourceId = nameToId.get(r.source)
    const targetId = nameToId.get(r.target)
    if (!sourceId || !targetId || sourceId === targetId) continue

    // Skip exact duplicates (same source+target+type) for this doc — we don't
    // want to bump the weight counter on re-ingestion of the same content.
    const existing = await db.relation.findFirst({
      where: { sourceId, targetId, type: r.type },
      select: { id: true },
    })
    if (existing) continue

    await db.relation.create({
      data: {
        sourceId,
        targetId,
        type: r.type,
        weight: 1.0,
        metadata: JSON.stringify({ docId }),
      },
    })
    created++
  }

  logger.info('Knowledge graph built', {
    docId,
    entities: entities.length,
    relations: created,
  })
}

/**
 * Find an entity by (case-insensitive) name and traverse its relations up to
 * `depth` hops. Returns the subgraph (entities + relations) reachable.
 */
export async function queryGraph(
  entityName: string,
  depth: number = 2,
): Promise<GraphQueryResult> {
  if (depth < 1) depth = 1
  const target = entityName.trim().toLowerCase()
  if (!target) return { entities: [], relations: [] }

  const seeds = await db.entity.findMany({
    where: { name: { contains: target } },
    select: { id: true, name: true, type: true, docId: true },
  })
  if (seeds.length === 0) {
    return { entities: [], relations: [] }
  }

  const visited = new Set<string>(seeds.map(s => s.id))
  const entityIds = new Set<string>(seeds.map(s => s.id))
  const collectedRelations: GraphQueryResult['relations'] = []

  let frontier: string[] = [...visited]

  for (let hop = 0; hop < depth; hop++) {
    if (frontier.length === 0) break

    // Pull all relations where either endpoint is in the frontier.
    const rels = await db.relation.findMany({
      where: {
        OR: [
          { sourceId: { in: frontier } },
          { targetId: { in: frontier } },
        ],
      },
      select: {
        id: true,
        sourceId: true,
        targetId: true,
        type: true,
        weight: true,
      },
    })

    const next: string[] = []
    for (const r of rels) {
      collectedRelations.push({
        id: r.id,
        source: r.sourceId,
        target: r.targetId,
        type: r.type,
        weight: r.weight,
      })
      for (const id of [r.sourceId, r.targetId]) {
        if (!visited.has(id)) {
          visited.add(id)
          entityIds.add(id)
          next.push(id)
        }
      }
    }
    frontier = next
  }

  const entityRows = await db.entity.findMany({
    where: { id: { in: Array.from(entityIds) } },
    select: { id: true, name: true, type: true, docId: true },
  })

  // Dedup relations by id (BFS may visit the same edge from both endpoints).
  const seenRel = new Set<string>()
  const relations = collectedRelations.filter(r => {
    if (seenRel.has(r.id)) return false
    seenRel.add(r.id)
    return true
  })

  return {
    entities: entityRows.map(e => ({
      id: e.id,
      name: e.name,
      type: e.type,
      docId: e.docId,
    })),
    relations,
  }
}

export const KnowledgeGraph = { extractEntities, extractRelations, buildGraph, queryGraph }
export default KnowledgeGraph
