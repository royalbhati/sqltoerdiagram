// AI-powered layout and semantic schema modularization:
// 1. Local AI semantic clustering (lexical tokenization + FK community detection) — 100% offline, zero API key required.
// 2. Google Gemini API semantic analysis (identifies enterprise business domains and module layout via LLM).

import { measureTable } from './renderer.js';

const DOMAIN_PALETTES = [
  { name: 'blue', hex: '#3b82f6', label: 'Auth & Identity' },
  { name: 'emerald', hex: '#10b981', label: 'Orders & Sales' },
  { name: 'purple', hex: '#8b5cf6', label: 'Catalog & Products' },
  { name: 'amber', hex: '#f59e0b', label: 'Billing & Finance' },
  { name: 'rose', hex: '#f43f5e', label: 'Customer & CRM' },
  { name: 'cyan', hex: '#06b6d4', label: 'System & Analytics' },
];

/**
 * Tokenize a table name into lowercase semantic words (supports snake_case, camelCase, kebab-case).
 */
export function tokenizeName(name) {
  if (!name) return [];
  return String(name)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-\.]+/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 1 && !/^\d+$/.test(w))
    .map(w => {
      if (w.endsWith('ies')) return w.slice(0, -3) + 'y';
      if (w.endsWith('es') && !w.endsWith('ses')) return w.slice(0, -2);
      if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
      return w;
    });
}

/**
 * Compute semantic keyword similarity between two tables.
 */
function lexicalSimilarity(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return 0;
  const setA = new Set(tokensA);
  let intersection = 0;
  for (const t of tokensB) {
    if (setA.has(t)) intersection++;
  }
  const union = new Set([...tokensA, ...tokensB]).size;
  return union > 0 ? intersection / union : 0;
}

/**
 * Local AI: Cluster tables into business domains using lexical similarity and FK graph connectivity.
 */
export function clusterTablesLocalAI(model) {
  const tables = model.tables || [];
  if (!tables.length) return [];

  const tableMap = new Map(tables.map(t => [t.key.toLowerCase(), t]));
  const tokensMap = new Map(tables.map(t => [t.key.toLowerCase(), tokenizeName(t.name || t.key)]));

  // Adjacency and connection counts
  const adj = new Map();
  for (const t of tables) adj.set(t.key.toLowerCase(), new Set());

  for (const r of (model.relations || [])) {
    const f = r.fromTable.toLowerCase(), t = r.toTable.toLowerCase();
    if (f !== t && adj.has(f) && adj.has(t)) {
      adj.get(f).add(t);
      adj.get(t).add(f);
    }
  }

  // Initial clusters: each table is its own cluster
  let clusters = tables.map(t => ({
    id: t.key.toLowerCase(),
    tables: [t.key.toLowerCase()],
    tokens: tokensMap.get(t.key.toLowerCase()) || [],
  }));

  // Target cluster count: 2 to 6 domains depending on table count
  const targetClusters = Math.max(1, Math.min(6, Math.ceil(tables.length / 4)));

  // Agglomerative clustering: merge most cohesive pair until target cluster count is reached
  while (clusters.length > targetClusters) {
    let bestScore = -1;
    let bestPair = null;

    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const c1 = clusters[i];
        const c2 = clusters[j];

        // 1. FK connectivity between clusters
        let fkLinks = 0;
        for (const t1 of c1.tables) {
          for (const t2 of c2.tables) {
            if (adj.get(t1)?.has(t2)) fkLinks++;
          }
        }
        const maxPossibleLinks = c1.tables.length * c2.tables.length;
        const linkScore = fkLinks / Math.max(1, maxPossibleLinks);

        // 2. Lexical keyword similarity
        const lexScore = lexicalSimilarity(c1.tokens, c2.tokens);

        // Combined score: heavily weight FKs + naming semantics
        const score = linkScore * 2.5 + lexScore * 1.5;

        if (score > bestScore) {
          bestScore = score;
          bestPair = [i, j];
        }
      }
    }

    if (!bestPair || bestScore <= 0.05) break; // Clusters are distinct enough

    const [i, j] = bestPair;
    const c1 = clusters[i];
    const c2 = clusters[j];

    const merged = {
      id: c1.id + '_' + c2.id,
      tables: [...c1.tables, ...c2.tables],
      tokens: [...new Set([...c1.tokens, ...c2.tokens])],
    };

    clusters.splice(j, 1);
    clusters.splice(i, 1, merged);
  }

  // Generate domain name and color for each cluster
  return clusters.map((c, idx) => {
    // Find most common tokens to name the domain
    const freq = {};
    for (const t of c.tokens) freq[t] = (freq[t] || 0) + 1;
    const sortedTokens = Object.entries(freq).sort((a, b) => b[1] - a[1]).map(e => e[0]);

    let domainName = 'Module ' + (idx + 1);
    if (sortedTokens.length >= 2) {
      domainName = capitalize(sortedTokens[0]) + ' & ' + capitalize(sortedTokens[1]);
    } else if (sortedTokens.length === 1) {
      domainName = capitalize(sortedTokens[0]) + ' Domain';
    } else if (c.tables.length === 1) {
      domainName = capitalize(c.tables[0]);
    }

    const palette = DOMAIN_PALETTES[idx % DOMAIN_PALETTES.length];

    return {
      name: domainName,
      color: palette.name,
      hex: palette.hex,
      tables: c.tables,
    };
  });
}

function capitalize(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Optimize 2D grid placement of domains so heavily interconnected domains sit adjacent to each other.
 */
export function optimizeDomainGridPositions(domains, relations = [], cols = 2) {
  const n = domains.length;
  const rows = Math.ceil(n / cols);
  const slots = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (slots.length < n) slots.push({ col: c, row: r });
    }
  }

  if (n <= 2) return slots.slice(0, n);

  // Map table -> domainIndex
  const tableToDomain = new Map();
  domains.forEach((d, idx) => {
    (d.tables || []).forEach(t => tableToDomain.set(String(t).toLowerCase(), idx));
  });

  // Inter-domain connection weight matrix
  const weights = Array.from({ length: n }, () => new Array(n).fill(0));
  for (const r of (relations || [])) {
    const fDom = tableToDomain.get(String(r.fromTable).toLowerCase());
    const tDom = tableToDomain.get(String(r.toTable).toLowerCase());
    if (fDom !== undefined && tDom !== undefined && fDom !== tDom) {
      weights[fDom][tDom]++;
      weights[tDom][fDom]++;
    }
  }

  function getCost(assignment) {
    let cost = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (weights[i][j] > 0) {
          const s1 = slots[assignment[i]];
          const s2 = slots[assignment[j]];
          const dist = Math.abs(s1.col - s2.col) + Math.abs(s1.row - s2.row);
          cost += weights[i][j] * dist;
        }
      }
    }
    return cost;
  }

  let bestAssignment = Array.from({ length: n }, (_, i) => i);
  let bestCost = getCost(bestAssignment);

  if (n <= 6) {
    function permute(arr, k = 0) {
      if (k === arr.length) {
        const c = getCost(arr);
        if (c < bestCost) { bestCost = c; bestAssignment = [...arr]; }
        return;
      }
      for (let i = k; i < arr.length; i++) {
        [arr[k], arr[i]] = [arr[i], arr[k]];
        permute(arr, k + 1);
        [arr[k], arr[i]] = [arr[i], arr[k]];
      }
    }
    permute([...bestAssignment]);
  } else {
    // Greedy placement
    const placed = new Array(n).fill(-1);
    const degrees = weights.map(row => row.reduce((a, b) => a + b, 0));
    const first = degrees.indexOf(Math.max(...degrees));
    placed[first] = 0;
    const usedSlots = new Set([0]);

    for (let step = 1; step < n; step++) {
      let bestDomain = -1, bestSlot = -1, bestScore = -Infinity;
      for (let d = 0; d < n; d++) {
        if (placed[d] !== -1) continue;
        for (let s = 0; s < n; s++) {
          if (usedSlots.has(s)) continue;
          let score = 0;
          for (let prev = 0; prev < n; prev++) {
            if (placed[prev] !== -1 && weights[d][prev] > 0) {
              const dist = Math.abs(slots[s].col - slots[placed[prev]].col) + Math.abs(slots[s].row - slots[placed[prev]].row);
              score += weights[d][prev] / dist;
            }
          }
          if (score > bestScore) {
            bestScore = score;
            bestDomain = d;
            bestSlot = s;
          }
        }
      }
      if (bestDomain !== -1 && bestSlot !== -1) {
        placed[bestDomain] = bestSlot;
        usedSlots.add(bestSlot);
      }
    }
    bestAssignment = placed;
  }

  return bestAssignment.map(slotIdx => slots[slotIdx]);
}

/**
 * Apply semantic domain layout to model tables.
 * Arranges domains in connection-optimized 2D grid cells with ample corridors,
 * and arranges tables within each domain cluster in a compact, readable formation.
 */
export function applySemanticDomainLayout(model, domains, createGroups = true, options = {}) {
  // Spacing from the Arrange menu. "comfortable" reproduces the original fixed
  // numbers exactly, so the default layout is unchanged; gutters between domain
  // boxes are damped to half the factor because widening them hurts routing
  // more than widening the gaps between tables.
  const SPACING = { compact: 0.75, comfortable: 1, spacious: 1.45 };
  const sf = SPACING[options.spacing] ?? 1;
  const gf = 1 + (sf - 1) * 0.5;
  const px = (v) => Math.round(v * sf);
  const gx = (v) => Math.round(v * gf);
  // Direction is not handled here: "Vertical" is this result turned a quarter
  // clockwise afterwards (rotate-diagram.js).

  const tableMap = new Map(model.tables.map(t => [t.key.toLowerCase(), t]));

  // Measure all tables
  for (const t of model.tables) {
    const dims = measureTable(t);
    t.w = dims.w; t.h = dims.h; t.rowH = dims.rowH; t.headerH = dims.headerH;
  }

  const n = domains.length;
  if (!n) return { domains: [], annotations: [] };

  const cols = Math.max(1, Math.min(3, Math.ceil(Math.sqrt(n))));
  const gridPositions = optimizeDomainGridPositions(domains, model.relations || [], cols);

  // Measure each domain's internal layout size first
  const domainSizes = domains.map((domain) => {
    const dTables = (domain.tables || []).map(k => tableMap.get(k)).filter(Boolean);
    if (!dTables.length) return { w: 280, h: 200, dTables: [], subCols: 1 };

    // A group box holds at most 3 columns; the invisible whole-diagram domain has
    // no box to keep narrow, so it takes a square grid rather than one tall strip.
    const maxCols = domain.implicit ? Infinity : 3;
    const subCols = Math.max(1, Math.min(maxCols, Math.ceil(Math.sqrt(dTables.length))));
    let subW = 0, subH = 0;
    let curX = px(32), curY = px(56), rowH = 0;

    for (let i = 0; i < dTables.length; i++) {
      const t = dTables[i];
      if (i > 0 && i % subCols === 0) {
        curY += rowH + px(36);
        curX = px(32);
        rowH = 0;
      }
      curX += t.w + px(56);
      rowH = Math.max(rowH, t.h);
      subW = Math.max(subW, curX);
      subH = Math.max(subH, curY + rowH + 32);
    }

    return {
      w: Math.max(280, subW + px(24)),
      h: Math.max(200, subH + px(20)),
      dTables,
      subCols,
    };
  });

  // Calculate row heights and col widths
  const rows = Math.ceil(n / cols);
  const colWidths = new Array(cols).fill(280);
  const rowHeights = new Array(rows).fill(200);

  for (let i = 0; i < n; i++) {
    const pos = gridPositions[i];
    const size = domainSizes[i];
    colWidths[pos.col] = Math.max(colWidths[pos.col], size.w);
    rowHeights[pos.row] = Math.max(rowHeights[pos.row], size.h);
  }

  // Corridors / Gutters between domain boxes: wide channels for cross-domain lines
  const GUTTER_X = gx(180);
  const GUTTER_Y = gx(160);

  // Calculate X/Y offsets for each grid cell
  const colX = [80];
  for (let c = 1; c < cols; c++) {
    colX[c] = colX[c - 1] + colWidths[c - 1] + GUTTER_X;
  }
  const rowY = [80];
  for (let r = 1; r < rows; r++) {
    rowY[r] = rowY[r - 1] + rowHeights[r - 1] + GUTTER_Y;
  }

  const generatedAnnotations = [];

  for (let dIdx = 0; dIdx < n; dIdx++) {
    const domain = domains[dIdx];
    const pos = gridPositions[dIdx];
    const size = domainSizes[dIdx];
    const currentX = colX[pos.col];
    const currentY = rowY[pos.row];

    // Place tables inside this domain box
    const subCols = size.subCols;
    let subX = currentX + px(32);
    let subY = currentY + px(56);
    let subRowMaxH = 0;

    for (let i = 0; i < size.dTables.length; i++) {
      const t = size.dTables[i];
      if (i > 0 && i % subCols === 0) {
        subY += subRowMaxH + px(48);
        subX = currentX + px(32);
        subRowMaxH = 0;
      }
      t.x = subX;
      t.y = subY;
      subX += t.w + px(56);
      subRowMaxH = Math.max(subRowMaxH, t.h);
    }

    if (createGroups && !domain.implicit) {
      generatedAnnotations.push({
        id: domain.id || ('group_ai_' + dIdx + '_' + Date.now().toString(36)),
        type: 'group',
        text: domain.name,
        color: domain.color || 'blue',
        tables: domain.tables,
        x: currentX,
        y: currentY,
        w: size.w,
        h: size.h,
      });
    }
  }

  return {
    domains,
    annotations: generatedAnnotations,
    lineStyle: options.lineStyle || null,
  };
}

/**
 * Query Gemini ModelService to find the best available Flash model that supports generateContent.
 */
async function findSupportedGeminiModel(cleanKey) {
  try {
    const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(cleanKey)}`;
    const res = await fetch(listUrl);
    if (res.ok) {
      const data = await res.json();
      const models = data?.models || [];
      // Strictly filter for Flash models that support generateContent (Pro models have 0 quota on free tier)
      const flashModels = models.filter(m =>
        Array.isArray(m.supportedGenerationMethods) &&
        m.supportedGenerationMethods.includes('generateContent') &&
        m.name?.includes('flash')
      );
      if (flashModels.length) {
        const preferred = flashModels.find(m => m.name?.includes('gemini-2.0-flash')) ||
                          flashModels.find(m => m.name?.includes('gemini-1.5-flash-8b')) ||
                          flashModels.find(m => m.name?.includes('gemini-1.5-flash-latest')) ||
                          flashModels.find(m => m.name?.includes('gemini-1.5-flash')) ||
                          flashModels[0];
        return preferred.name.replace(/^models\//, '');
      }
    }
  } catch {
    // Network or restricted key: fallback to static candidate list
  }
  return null;
}

/**
 * Robustly parse JSON from Gemini, handling markdown code fences.
 */
function extractJSON(rawText) {
  if (!rawText) return null;
  const trimmed = rawText.trim();
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1] : trimmed;
  try {
    return JSON.parse(jsonStr);
  } catch {
    const start = jsonStr.indexOf('{');
    const end = jsonStr.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(jsonStr.substring(start, end + 1));
    }
    throw new Error('No valid JSON object found in Gemini response.');
  }
}

/**
 * Execute reordering with Google Gemini API.
 */
export async function reorderWithGemini(model, apiKey, options = {}) {
  const cleanKey = apiKey ? apiKey.trim() : '';
  if (!cleanKey) {
    throw new Error('Gemini API Key is required. Please provide a key or choose Local AI.');
  }

  const schemaSummary = {
    tables: model.tables.map(t => ({
      name: t.name || t.key,
      columns: (t.columns || []).map(c => c.name),
    })),
    relations: (model.relations || []).map(r => ({
      from: r.fromTable,
      to: r.toTable,
      fromCol: r.fromCols?.[0],
      toCol: r.toCols?.[0],
    })),
  };

  const prompt = `You are an expert database architect. Analyze this database schema and organize its tables into cohesive business domains (e.g. "Users & Authentication", "Billing & Payments", "Products & Inventory", "Orders & Shipping").

Database Schema:
${JSON.stringify(schemaSummary, null, 2)}

Respond with ONLY a valid JSON object matching this schema:
{
  "domains": [
    {
      "name": "Domain Title",
      "color": "blue | emerald | purple | amber | rose | cyan",
      "tables": ["table1", "table2"]
    }
  ]
}
Include every single table from the schema. Do not omit any tables.`;

  // 1. Discover available Flash model or use high-quota Flash candidate sequence (never Pro models first)
  const discoveredModel = await findSupportedGeminiModel(cleanKey);
  const modelsToTry = [
    ...(discoveredModel ? [discoveredModel] : []),
    'gemini-2.0-flash',
    'gemini-1.5-flash-8b',
    'gemini-1.5-flash',
    'gemini-1.5-flash-latest',
    'gemini-1.5-flash-001',
    'gemini-1.5-flash-002',
  ];

  let lastError = null;
  let rawText = null;

  for (const modelName of [...new Set(modelsToTry)]) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(cleanKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
          },
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const msg = errJson?.error?.message || (await res.text().catch(() => res.statusText));
        lastError = new Error(`Gemini API (${modelName} ${res.status}): ${msg}`);
        // If 404 (model not found) or 429 (rate/quota limit on this model), try next Flash candidate!
        if (res.status === 404 || res.status === 429) continue;
        throw lastError; // Stop on invalid key (400, 401, 403)
      }

      const data = await res.json();
      rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (rawText) break;
    } catch (e) {
      lastError = e;
      if (e.message?.includes('404') || e.message?.includes('429')) continue;
      throw e;
    }
  }

  if (!rawText) {
    // If Gemini quota is exceeded on all models or unavailable, fallback automatically to Local AI
    console.warn('Gemini quota reached on free tier. Gracefully falling back to Local AI:', lastError?.message);
    const localResult = reorderWithLocalAI(model, options);
    return {
      ...localResult,
      fallbackToLocal: true,
      originalError: lastError?.message || 'Quota exceeded (429)',
    };
  }

  const parsed = extractJSON(rawText);
  if (!parsed.domains || !Array.isArray(parsed.domains)) {
    throw new Error('Invalid JSON structure returned by Gemini.');
  }

  // Validate tables: map case-insensitively to exact table keys
  const validKeys = new Map(model.tables.map(t => [t.key.toLowerCase(), t.key]));
  const seen = new Set();

  const domains = parsed.domains.map(d => {
    const mappedTables = (d.tables || [])
      .map(k => validKeys.get(String(k).toLowerCase()))
      .filter(k => k && !seen.has(k));
    for (const k of mappedTables) seen.add(k);
    return {
      name: d.name || 'Domain',
      color: d.color || 'blue',
      tables: mappedTables,
    };
  }).filter(d => d.tables.length > 0);

  // Add any omitted tables to an "Other / General" domain
  const omitted = model.tables.filter(t => !seen.has(t.key)).map(t => t.key);
  if (omitted.length) {
    domains.push({
      name: 'General',
      color: 'cyan',
      tables: omitted,
    });
  }

  return applySemanticDomainLayout(model, domains, options.createGroups !== false, options);
}

/**
 * Execute reordering with Local Semantic AI (zero network, zero API key).
 */
export function reorderWithLocalAI(model, options = {}) {
  const domains = clusterTablesLocalAI(model);
  return applySemanticDomainLayout(model, domains, options.createGroups !== false, options);
}

/**
 * Execute reordering with physical layout algorithm preserving the user's existing groups.
 */
export function reorderWithExistingGroups(model, annotations = [], options = {}) {
  const tables = model?.tables || [];
  if (!tables.length) {
    throw new Error('The model has no tables.');
  }

  const tableMap = new Map(tables.map(t => [t.key.toLowerCase(), t]));
  const groupAnnos = (annotations || []).filter(a => a.type === 'group');

  const rawGroups = [];
  if (groupAnnos.length) {
    for (const a of groupAnnos) {
      let memberKeys = [];
      if (Array.isArray(a.tables) && a.tables.length) {
        memberKeys = a.tables
          .map(k => String(k).toLowerCase())
          .filter(k => tableMap.has(k));
      }
      // If a.tables is empty, detect tables inside group's bounding box
      if (!memberKeys.length && Number.isFinite(a.x) && Number.isFinite(a.y)) {
        for (const t of tables) {
          if (Number.isFinite(t.x) && Number.isFinite(t.y) &&
              t.x >= a.x - 20 && t.x + (t.w || 100) <= a.x + a.w + 20 &&
              t.y >= a.y - 20 && t.y + (t.h || 50) <= a.y + a.h + 20) {
            memberKeys.push(t.key.toLowerCase());
          }
        }
      }
      if (memberKeys.length) {
        rawGroups.push({
          id: a.id,
          name: a.text || 'Group',
          color: a.color || 'blue',
          tables: memberKeys,
        });
      }
    }
  } else if (Array.isArray(model.groups) && model.groups.length) {
    for (const g of model.groups) {
      const memberKeys = (g.tables || [])
        .map(k => String(k).toLowerCase())
        .filter(k => tableMap.has(k));
      if (memberKeys.length) {
        rawGroups.push({
          name: g.name || 'Group',
          color: g.color || 'blue',
          tables: memberKeys,
        });
      }
    }
  }

  // No groups at all: every table goes into one invisible domain, so the grid
  // still lays the diagram out. It never gets a box drawn around it.
  if (!rawGroups.length) {
    const all = { name: '', tables: tables.map(t => t.key.toLowerCase()), implicit: true };
    return { ...applySemanticDomainLayout(model, [all], options.createGroups !== false, options), implicit: true };
  }

  // Deduplicate tables across groups (each table assigned to at most one group)
  const seenTables = new Set();
  const domains = [];
  for (const g of rawGroups) {
    const uniqueTables = [];
    for (const tk of g.tables) {
      if (!seenTables.has(tk)) {
        seenTables.add(tk);
        uniqueTables.push(tk);
      }
    }
    if (uniqueTables.length) {
      domains.push({
        id: g.id,
        name: g.name,
        color: g.color,
        tables: uniqueTables,
      });
    }
  }

  // Any table not in a group is placed in a "General" / unassigned group so it is organized cleanly
  const unassigned = tables
    .filter(t => !seenTables.has(t.key.toLowerCase()))
    .map(t => t.key.toLowerCase());
  if (unassigned.length) {
    domains.push({
      name: 'General',
      color: 'cyan',
      tables: unassigned,
    });
  }

  return applySemanticDomainLayout(model, domains, options.createGroups !== false, options);
}
