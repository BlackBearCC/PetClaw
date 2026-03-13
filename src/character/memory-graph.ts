/**
 * Character Engine — MemoryGraphSystem
 *
 * Server-side memory cluster management:
 * - Receives userMsg + aiReply after each chat completion
 * - Calls LLM to extract memorable info (interests/habits/projects/preferences)
 * - Manages clusters (merge, prune, keyword inference)
 * - Indexes clusters into memory_search (SQLite FTS) via callback
 *
 * Persistence: file-based JSON via PersistenceStore (same as other character subsystems).
 * LLM calls: injected callback (set by gateway).
 */

import type { PersistenceStore } from "./attribute-engine.js";

// ─── Types ───

export type LLMCompleteCallback = (prompt: string) => Promise<string | null>;
export type MemoryExtractedCallback = (cluster: MemoryCluster) => void;

export interface MemoryCluster {
  id: string;
  theme: string;
  keywords: string[];
  implicitKeywords: string[];
  summary: string;
  fragments: MemoryFragment[];
  relatedClusters: string[];
  weight: number;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryFragment {
  id: string;
  text: string;
  userMsg: string;
  aiReply: string;
  timestamp: number;
}

interface MemoryGraphData {
  clusters: Record<string, MemoryCluster>;
  meta: {
    extractCount: number;
    lastExtractAt: number;
    version: number;
  };
}

// ─── Constants ───

const STORE_KEY = "memory-graph";
const MAX_CLUSTERS = 50;
const MAX_FRAGMENTS_PER_CLUSTER = 20;
const DEBOUNCE_MS = 3000;

function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// ─── Helpers ───

/**
 * Smart truncation for AI replies: head(40%) + middle(20%) + tail(40%).
 * Splits by sentence/clause boundaries before cutting, then joins with "……".
 */
function smartTruncateAiReply(text: string, maxLen: number): string {
  if (!text || text.length <= maxLen) return text;

  const EL = "……";
  // Split into segments at sentence/clause boundaries (keeping the delimiter)
  const segs = text.match(/[^。！？.!?，,；;\n]+[。！？.!?，,；;\n]*/g) ?? [text];

  if (segs.length < 3 || maxLen < 20) {
    const keep = Math.floor((maxLen - EL.length) / 2);
    return text.slice(0, keep) + EL + text.slice(-keep);
  }

  const budget = maxLen - EL.length * 2;
  const hBudget = Math.floor(budget * 0.4);
  const tBudget = Math.floor(budget * 0.4);
  const mBudget = budget - hBudget - tBudget;

  let head = "", hi = 0;
  while (hi < segs.length && head.length + segs[hi].length <= hBudget) head += segs[hi++];

  let tail = "", ti = segs.length - 1;
  while (ti >= hi && tail.length + segs[ti].length <= tBudget) tail = segs[ti--] + tail;

  let mid = "";
  if (hi <= ti && mBudget > 0) {
    const midIdx = Math.floor((hi + ti) / 2);
    for (let mi = midIdx; mi <= ti && mid.length + segs[mi].length <= mBudget; mi++) {
      mid += segs[mi];
    }
  }

  return [head, mid, tail].filter(s => s.length > 0).join(EL);
}

// ─── System ───

export class MemoryGraphSystem {
  private _store: PersistenceStore;
  private _data: MemoryGraphData;
  private _busy = false;
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _queue: Array<{ userMsg: string; aiReply: string }> = [];
  private _llmComplete: LLMCompleteCallback | null = null;
  private _onIndexClusters: ((clusters: MemoryCluster[]) => void) | null = null;
  private _onExtracted: MemoryExtractedCallback | null = null;
  private _errorCount = 0;
  /** ID of the cluster that was created or updated in the last extraction */
  private _lastChangedClusterId: string | null = null;

  constructor(store: PersistenceStore) {
    this._store = store;
    this._data = this._load();
  }

  /** Register the LLM completion callback (set by gateway) */
  setLLMComplete(callback: LLMCompleteCallback): void {
    this._llmComplete = callback;
  }

  /** Register the cluster indexing callback (called after extraction with changed clusters only) */
  setIndexCallback(callback: (clusters: MemoryCluster[]) => void): void {
    this._onIndexClusters = callback;
  }

  /** Register the extraction callback (called when a new memory is extracted) */
  setExtractedCallback(callback: MemoryExtractedCallback): void {
    this._onExtracted = callback;
  }

  /** Get current cluster array */
  getClusters(): MemoryCluster[] {
    return Object.values(this._data.clusters);
  }

  /** Get total fragment count */
  getFragmentCount(): number {
    return this.getClusters().reduce((sum, c) => sum + c.fragments.length, 0);
  }

  /** Get status info */
  getStatus() {
    return {
      clusterCount: this.getClusters().length,
      fragmentCount: this.getFragmentCount(),
      extractCount: this._data.meta.extractCount,
      lastExtractAt: this._data.meta.lastExtractAt,
    };
  }

  // ─── Extraction entry ───

  /**
   * Enqueue extraction with debounce (3s).
   * Called after each chat completion via character.memory.extract RPC.
   * Uses a queue so rapid-fire messages are never lost.
   */
  enqueueExtraction(userMsg: string, aiReply: string): void {
    if ((!userMsg && !aiReply) || (userMsg + aiReply).length < 10) return;
    this._queue.push({ userMsg, aiReply });
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this._drainQueue(), DEBOUNCE_MS);
  }

  private async _drainQueue(): Promise<void> {
    if (this._busy || this._queue.length === 0) return;
    const item = this._queue.shift()!;
    await this.extractAndMerge(item.userMsg, item.aiReply);
    // If more items remain, schedule next extraction
    if (this._queue.length > 0) {
      this._debounceTimer = setTimeout(() => this._drainQueue(), DEBOUNCE_MS);
    }
  }

  // ─── LLM extraction ───

  async extractAndMerge(userMsg: string, aiReply: string): Promise<void> {
    if (this._busy) {
      console.log("[MemoryGraph] Busy, queued for later");
      return;
    }
    if (!this._llmComplete) {
      console.log("[MemoryGraph] No LLM callback, skipping extraction");
      return;
    }
    this._busy = true;
    this._lastChangedClusterId = null;
    try {
      const themes = this.getClusters().map(c => c.theme).join("、");

      const prompt = `[角色]
你是记忆管理器。

[情景]
用户: ${userMsg}
AI回复: ${smartTruncateAiReply(aiReply, 500)}
已有记忆簇: ${themes || "（空）"}

[任务]
判断这段对话是否包含值得长期记住的用户信息（兴趣/习惯/项目/人际/偏好/情感/技能/工作）。
闲聊、打招呼、简单问答不值得记忆。
如果值得记忆，决定归入已有簇还是新建簇。

返回严格JSON（无代码块标记，无其他文字）：
{"worth":true,"cluster":"已有簇主题或null","newTheme":"新簇主题或null","keywords":["显式关键词1","显式关键词2"],"implicitKeywords":["同义词","上位概念","关联术语","用户可能用的其他说法"],"fragment":"这段对话的记忆摘要，一句话","summaryUpdate":"归入已有簇时更新后的簇摘要，新建时为初始摘要"}
keywords=对话中直接出现的词；implicitKeywords=未直接出现但语义相关的词（同义词、缩写、上位概念、口语说法），用于提升召回率。
不值得记忆时返回：{"worth":false}`;

      const result = await this._llmComplete(prompt);
      console.log("[MemoryGraph] LLM result:", result?.slice(0, 200));
      if (!result) {
        console.log("[MemoryGraph] No LLM result");
        return;
      }

      const match = result.match(/\{[\s\S]*\}/);
      if (!match) {
        console.warn("[MemoryGraph] No JSON found in LLM result:", result.slice(0, 300));
        this._errorCount++;
        return;
      }

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(match[0]);
      } catch (parseErr) {
        console.warn("[MemoryGraph] JSON parse failed:", parseErr, "raw:", match[0].slice(0, 200));
        this._errorCount++;
        return;
      }
      console.log("[MemoryGraph] Parsed:", JSON.stringify(parsed));
      if (!parsed.worth) {
        console.log("[MemoryGraph] Not worth remembering");
        return;
      }

      this._merge(parsed as Parameters<typeof this._merge>[0], userMsg, aiReply);
      this._prune();
      this._data.meta.extractCount++;
      this._data.meta.lastExtractAt = Date.now();
      this._save();

      // Index only the changed cluster into memory search
      this._indexToMemorySearch();

      // Notify callback (for first-time experience)
      if (this._onExtracted && this._lastChangedClusterId) {
        const changedCluster = this._data.clusters[this._lastChangedClusterId];
        if (changedCluster) {
          this._onExtracted(changedCluster);
        }
      }
    } catch (err) {
      this._errorCount++;
      console.warn("[MemoryGraph] Extraction failed (total errors: %d):", this._errorCount, err);
    } finally {
      this._busy = false;
      // Continue draining queue if items remain
      if (this._queue.length > 0) {
        this._debounceTimer = setTimeout(() => this._drainQueue(), DEBOUNCE_MS);
      }
    }
  }

  // ─── Merge logic ───

  private _merge(
    parsed: {
      cluster?: string;
      newTheme?: string;
      keywords?: string[];
      implicitKeywords?: string[];
      fragment?: string;
      summaryUpdate?: string;
    },
    userMsg: string,
    aiReply: string,
  ): void {
    const { cluster, newTheme, keywords = [], implicitKeywords = [], fragment, summaryUpdate } = parsed;
    const now = Date.now();

    const frag: MemoryFragment = {
      id: genId("f"),
      text: (fragment ?? "").slice(0, 120),
      userMsg: userMsg ?? "",
      aiReply: smartTruncateAiReply(aiReply ?? "", 300),
      timestamp: now,
    };

    if (cluster) {
      const existing = this._findClusterByTheme(cluster);
      if (existing) {
        existing.fragments.push(frag);
        if (existing.fragments.length > MAX_FRAGMENTS_PER_CLUSTER) {
          existing.fragments = existing.fragments.slice(-MAX_FRAGMENTS_PER_CLUSTER);
        }
        existing.weight++;
        existing.updatedAt = now;
        if (summaryUpdate) existing.summary = summaryUpdate.slice(0, 200);
        const kwSet = new Set(existing.keywords);
        for (const kw of keywords) kwSet.add(kw.toLowerCase());
        existing.keywords = [...kwSet].slice(0, 15);
        const ikwSet = new Set(existing.implicitKeywords);
        for (const kw of implicitKeywords) ikwSet.add(kw.toLowerCase());
        existing.implicitKeywords = [...ikwSet].slice(0, 20);
        this._lastChangedClusterId = existing.id;
        return;
      }
      // Fall through to create new cluster
    }

    const id = genId("mc");
    const newCluster: MemoryCluster = {
      id,
      theme: (newTheme ?? cluster ?? fragment ?? "").slice(0, 30),
      keywords: keywords.map(k => k.toLowerCase()).slice(0, 10),
      implicitKeywords: implicitKeywords.map(k => k.toLowerCase()).slice(0, 15),
      summary: (summaryUpdate ?? fragment ?? "").slice(0, 200),
      fragments: [frag],
      relatedClusters: [],
      weight: 1,
      createdAt: now,
      updatedAt: now,
    };
    this._data.clusters[id] = newCluster;
    this._lastChangedClusterId = id;
    this._inferRelations(newCluster);
  }

  private _findClusterByTheme(theme: string): MemoryCluster | undefined {
    const lower = theme.toLowerCase().trim();
    const norm = Object.values(this._data.clusters).map(c => ({ c, cl: c.theme.toLowerCase().trim() }));

    // 1. Exact match
    const exact = norm.find(({ cl }) => cl === lower);
    if (exact) return exact.c;

    // 2. Substring containment — both sides must be ≥3 chars to avoid
    //    short themes like "AI" matching unrelated clusters ("AI绘画" vs "AI编程")
    if (lower.length >= 3) {
      const contained = norm.find(({ cl }) =>
        cl.length >= 3 && (cl.includes(lower) || lower.includes(cl))
      );
      if (contained) return contained.c;
    }

    // No fuzzy character-overlap matching — trust LLM's cluster field instead
    return undefined;
  }

  private _inferRelations(newCluster: MemoryCluster): void {
    const newKws = new Set(newCluster.keywords);
    for (const c of Object.values(this._data.clusters)) {
      if (c.id === newCluster.id) continue;
      const overlap = c.keywords.filter(k => newKws.has(k));
      if (overlap.length >= 1) {
        if (!newCluster.relatedClusters.includes(c.id)) {
          newCluster.relatedClusters.push(c.id);
        }
        if (!c.relatedClusters.includes(newCluster.id)) {
          c.relatedClusters.push(newCluster.id);
        }
      }
    }
  }

  // ─── Prune ───

  /**
   * Prune clusters when exceeding MAX_CLUSTERS.
   * Score = weight × timeDecay, where decay halves every 30 days of inactivity.
   * This prevents high-weight but stale clusters from hogging slots forever,
   * while keeping recent one-time important memories alive.
   */
  private _prune(): void {
    const clusters = Object.values(this._data.clusters);
    if (clusters.length <= MAX_CLUSTERS) return;

    const now = Date.now();
    const HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

    const scored = clusters.map(c => {
      const age = now - c.updatedAt;
      const decay = Math.pow(0.5, age / HALF_LIFE_MS);
      return { c, score: c.weight * decay };
    });

    scored.sort((a, b) => a.score - b.score);
    const toRemove = scored.slice(0, scored.length - MAX_CLUSTERS);
    const removeIds = new Set(toRemove.map(s => s.c.id));

    for (const id of removeIds) {
      delete this._data.clusters[id];
    }

    for (const c of Object.values(this._data.clusters)) {
      c.relatedClusters = c.relatedClusters.filter(id => !removeIds.has(id));
    }
  }

  // ─── In-memory keyword search ───

  /**
   * Search clusters by keyword/phrase. Returns top-N clusters ranked by
   * how many tokens from the query appear in theme/keywords/summary/fragments.
   */
  search(query: string, topN = 5): MemoryCluster[] {
    const clusters = this.getClusters();
    if (!clusters.length || !query.trim()) return [];

    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);

    const scored = clusters.map((c) => {
      const haystack = [
        c.theme,
        ...c.keywords,
        ...(c.implicitKeywords ?? []),
        c.summary,
        ...c.fragments.map((f) => f.text),
      ]
        .join(" ")
        .toLowerCase();

      let score = 0;
      for (const token of tokens) {
        if (haystack.includes(token)) score += 1;
      }
      // Boost by weight so frequently-updated clusters surface higher
      score += c.weight * 0.1;
      return { cluster: c, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topN)
      .map((s) => s.cluster);
  }

  // ─── Index to memory search ───

  /** Only send the cluster that was created/updated, not the full set */
  private _indexToMemorySearch(): void {
    if (!this._onIndexClusters || !this._lastChangedClusterId) return;
    const changed = this._data.clusters[this._lastChangedClusterId];
    if (!changed) return;
    try {
      this._onIndexClusters([changed]);
    } catch (err) {
      console.warn("[MemoryGraph] indexClusters failed:", err);
    }
  }

  // ─── Persistence ───

  private _load(): MemoryGraphData {
    try {
      const saved = this._store.load(STORE_KEY) as MemoryGraphData | null;
      if (saved?.clusters && saved?.meta) return saved;
    } catch { /* ignore */ }
    return { clusters: {}, meta: { extractCount: 0, lastExtractAt: 0, version: 2 } };
  }

  private _save(): void {
    this._store.save(STORE_KEY, this._data as unknown as Record<string, unknown>);
  }
}
