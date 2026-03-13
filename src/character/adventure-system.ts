/**
 * Adventure System — Exploration and adventure mechanics
 *
 * AI can start adventures (idle/interactive/explore modes).
 * Adventures generate rewards and narratives based on character state.
 * LLM generates story/choices on start and rich narrative on completion.
 */

import type { EventBus } from "./event-bus.js";
import type { PersistenceStore } from "./attribute-engine.js";

// ─── Types ───

export type AdventureType = "idle" | "interactive" | "explore";
export type AdventureRisk = "safe" | "moderate" | "dangerous";
export type AdventureStatus = "ongoing" | "completed";

export interface AdventureRewards {
  exp: number;
  coins: number;
  items?: string[];
}

export interface AdventureChoice {
  id: string;
  text: string;
}

export interface AdventureResult {
  success: boolean;
  narrative: string;
  rewards: AdventureRewards;
  damage?: number;
}

export interface Adventure {
  id: string;
  type: AdventureType;
  location: string;
  duration: number; // minutes
  status: AdventureStatus;
  risk: AdventureRisk;
  rewards: AdventureRewards;
  story?: string;
  choices?: AdventureChoice[];
  selectedChoice?: string;
  result?: AdventureResult;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
}

export interface AdventureSystemConfig {
  maxActiveAdventures?: number;
  baseRewards?: {
    safe: AdventureRewards;
    moderate: AdventureRewards;
    dangerous: AdventureRewards;
  };
}

/** LLM completion callback — same pattern as memory-graph / chat-eval */
export type AdventureLLMCallback = (prompt: string) => Promise<string | null>;

const DEFAULT_CONFIG: Required<AdventureSystemConfig> = {
  maxActiveAdventures: 1,
  baseRewards: {
    safe: { exp: 20, coins: 10 },
    moderate: { exp: 50, coins: 25 },
    dangerous: { exp: 100, coins: 50 },
  },
};

const RISK_LABELS: Record<AdventureRisk, string> = {
  safe: "安全",
  moderate: "中等风险",
  dangerous: "危险",
};

// ─── Adventure System ───

export class AdventureSystem {
  private readonly bus: EventBus;
  private readonly store: PersistenceStore;
  private readonly config: Required<AdventureSystemConfig>;
  private adventures: Map<string, Adventure> = new Map();
  private activeAdventureId: string | null = null;
  private _llmComplete: AdventureLLMCallback | null = null;
  /** Prevents tick() from double-triggering while async LLM completes */
  private _completing = false;

  constructor(
    bus: EventBus,
    store: PersistenceStore,
    config?: AdventureSystemConfig
  ) {
    this.bus = bus;
    this.store = store;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.load();
  }

  /** Register the LLM completion callback (set by gateway) */
  setLLMComplete(callback: AdventureLLMCallback): void {
    this._llmComplete = callback;
  }

  private load(): void {
    const data = this.store.load("adventure-system");
    if (data?.adventures) {
      const list = data.adventures as Adventure[];
      for (const adv of list) {
        this.adventures.set(adv.id, adv);
        if (adv.status === "ongoing") {
          this.activeAdventureId = adv.id;
        }
      }
    }
  }

  private save(): void {
    // Trim completed adventures to last 50 to prevent unbounded growth
    const completed = Array.from(this.adventures.values())
      .filter((a) => a.status === "completed")
      .sort((a, b) => (b.endedAt ?? b.createdAt) - (a.endedAt ?? a.createdAt));
    if (completed.length > 50) {
      for (const adv of completed.slice(50)) {
        this.adventures.delete(adv.id);
      }
    }

    this.store.save("adventure-system", {
      adventures: Array.from(this.adventures.values()),
    });
  }

  /**
   * Start a new adventure
   */
  startAdventure(params: {
    type: AdventureType;
    location: string;
    duration: number;
    risk: AdventureRisk;
    story?: string;
    choices?: AdventureChoice[];
  }): Adventure | { error: string } {
    // Check if already on an adventure
    if (this.activeAdventureId) {
      const active = this.adventures.get(this.activeAdventureId);
      if (active && active.status === "ongoing") {
        return { error: "Already on an adventure" };
      }
    }

    const id = `adv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const adventure: Adventure = {
      id,
      type: params.type,
      location: params.location,
      duration: params.duration,
      status: "ongoing",
      risk: params.risk,
      rewards: this.config.baseRewards[params.risk],
      story: params.story,
      choices: params.choices,
      createdAt: Date.now(),
      startedAt: Date.now(),
    };

    this.adventures.set(id, adventure);
    this.activeAdventureId = id;
    this.save();

    this.bus.emit("adventure:started", { adventure });

    return adventure;
  }

  /**
   * Generate story + choices for an adventure via LLM.
   * Called after startAdventure; mutates the adventure in-place and saves.
   * Returns true if LLM generation succeeded.
   */
  async generateStory(adventureId: string): Promise<boolean> {
    const adventure = this.adventures.get(adventureId);
    if (!adventure || !this._llmComplete) return false;
    // Skip if story already provided by caller
    if (adventure.story) return true;

    const isInteractive = adventure.type === "interactive";
    const prompt = `你是一个桌面宠物的探险叙事生成器。请根据以下信息生成一段探险开场叙事。

探险信息：
- 地点：${adventure.location}
- 类型：${adventure.type === "idle" ? "闲置探险" : adventure.type === "interactive" ? "交互探险" : "主动探索"}
- 风险等级：${RISK_LABELS[adventure.risk]}
- 时长：${adventure.duration}分钟

要求：
1. 用第二人称"你"来叙述，语气活泼有趣
2. 生成一段2-3句话的开场故事描述（story字段）
3. ${isInteractive ? "生成3个有趣的选择分支（choices数组），每个选择会影响探险走向" : "不需要生成choices"}
4. 故事要符合地点和风险等级的氛围

返回严格JSON（无代码块标记）：
${isInteractive
  ? `{"story":"开场叙事...","choices":[{"id":"c1","text":"选择1"},{"id":"c2","text":"选择2"},{"id":"c3","text":"选择3"}]}`
  : `{"story":"开场叙事..."}`
}`;

    try {
      const raw = await this._llmComplete(prompt);
      if (!raw) return false;
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) return false;
      const parsed = JSON.parse(match[0]) as { story?: string; choices?: Array<{ id?: string; text?: string }> };
      if (!parsed.story) return false;

      adventure.story = parsed.story;
      if (isInteractive && Array.isArray(parsed.choices) && parsed.choices.length >= 2) {
        adventure.choices = parsed.choices
          .filter((c) => c.text)
          .map((c, i) => ({ id: c.id || `c${i + 1}`, text: c.text! }));
      }
      this.save();
      return true;
    } catch (err) {
      console.log("[Adventure] LLM story generation failed:", err);
      return false;
    }
  }

  /**
   * Make a choice in an interactive adventure
   */
  makeChoice(adventureId: string, choiceId: string): Adventure | { error: string } {
    const adventure = this.adventures.get(adventureId);
    if (!adventure) {
      return { error: "Adventure not found" };
    }

    if (adventure.status !== "ongoing") {
      return { error: "Adventure not ongoing" };
    }

    if (adventure.type !== "interactive") {
      return { error: "Not an interactive adventure" };
    }

    adventure.selectedChoice = choiceId;
    this.save();

    this.bus.emit("adventure:choice", { adventure, choiceId });

    return adventure;
  }

  /**
   * Complete an adventure with results
   */
  completeAdventure(adventureId: string, result?: AdventureResult): Adventure | { error: string } {
    const adventure = this.adventures.get(adventureId);
    if (!adventure) {
      return { error: "Adventure not found" };
    }

    if (adventure.status !== "ongoing") {
      return { error: "Adventure not ongoing" };
    }

    // Generate result if not provided
    const finalResult: AdventureResult = result ?? this._generateResultSync(adventure);

    adventure.status = "completed";
    adventure.endedAt = Date.now();
    adventure.result = finalResult;
    this.activeAdventureId = null;
    this._completing = false;
    this.save();

    this.bus.emit("adventure:completed", { adventure, result: finalResult });

    return adventure;
  }

  /**
   * Async completion: try LLM narrative, fall back to sync generation.
   * Used by tick() for richer auto-completion narratives.
   */
  private async _completeWithLLM(adventureId: string): Promise<void> {
    const adventure = this.adventures.get(adventureId);
    if (!adventure || adventure.status !== "ongoing") {
      this._completing = false;
      return;
    }

    // Determine success first (same logic as sync path)
    const success = this._rollSuccess(adventure);
    const rewards = this._calculateRewards(adventure, success);

    // Try LLM narrative
    let narrative: string | null = null;
    if (this._llmComplete) {
      try {
        narrative = await this._generateNarrativeLLM(adventure, success);
      } catch {
        // fall through to sync fallback
      }
    }

    if (!narrative) {
      narrative = this._pickFallbackNarrative(adventure, success);
    }

    // Finalize — adventure may have been cancelled during LLM call
    const current = this.adventures.get(adventureId);
    if (!current || current.status !== "ongoing") {
      this._completing = false;
      return;
    }

    this.completeAdventure(adventureId, {
      success,
      narrative,
      rewards,
      damage: success ? undefined : 10,
    });
  }

  /**
   * Generate a completion narrative via LLM
   */
  private async _generateNarrativeLLM(adventure: Adventure, success: boolean): Promise<string | null> {
    if (!this._llmComplete) return null;

    const choiceText = adventure.selectedChoice && adventure.choices
      ? adventure.choices.find((c) => c.id === adventure.selectedChoice)?.text ?? "无"
      : "无";

    const prompt = `你是一个桌面宠物的探险叙事生成器。请根据以下探险结果生成一段结局叙事。

探险信息：
- 地点：${adventure.location}
- 类型：${adventure.type === "idle" ? "闲置探险" : adventure.type === "interactive" ? "交互探险" : "主动探索"}
- 风险等级：${RISK_LABELS[adventure.risk]}
- 时长：${adventure.duration}分钟
- 开场故事：${adventure.story || "无"}
- 做出的选择：${choiceText}
- 结果：${success ? "成功" : "失败"}

要求：
1. 用第二人称"你"叙述，语气生动有趣，3-4句话
2. 结局要与开场故事和选择呼应
3. 成功时描述收获和惊喜，失败时描述遗憾但要有鼓励
4. 不要提及具体的数值奖励

只返回叙事文本，不要JSON包裹，不要引号。`;

    const raw = await this._llmComplete(prompt);
    if (!raw) return null;
    // Strip any accidental JSON wrapping or quotes
    const cleaned = raw.replace(/^["'`]+|["'`]+$/g, "").trim();
    return cleaned.length > 10 ? cleaned : null;
  }

  /**
   * Roll success/failure based on risk + choice
   */
  private _rollSuccess(adventure: Adventure): boolean {
    const successChances: Record<AdventureRisk, number> = {
      safe: 0.9,
      moderate: 0.7,
      dangerous: 0.5,
    };

    let successChance = successChances[adventure.risk];

    if (adventure.selectedChoice && adventure.choices?.length) {
      const idx = adventure.choices.findIndex((c) => c.id === adventure.selectedChoice);
      if (idx === 0) successChance += 0.1;
      else if (idx === adventure.choices.length - 1) successChance -= 0.1;
    }

    return Math.random() < successChance;
  }

  /**
   * Calculate rewards based on success/failure
   */
  private _calculateRewards(adventure: Adventure, success: boolean): AdventureRewards {
    let rewards: AdventureRewards = { ...adventure.rewards };
    if (!success) {
      rewards = {
        exp: Math.floor(rewards.exp * 0.3),
        coins: Math.floor(rewards.coins * 0.3),
      };
    }

    // Add random items on success — must use valid ITEM_DEFS keys
    if (success && Math.random() > 0.5) {
      const items = ["巴别鱼罐头", "不要恐慌胶囊", "马文牌退烧贴", "泛银河爆破饮"];
      rewards.items = [items[Math.floor(Math.random() * items.length)]];
    }

    return rewards;
  }

  /**
   * Fallback hardcoded narratives (used when LLM unavailable)
   */
  private _pickFallbackNarrative(adventure: Adventure, success: boolean): string {
    const narratives = success
      ? [
          `探险成功！你在${adventure.location}发现了宝藏。`,
          `经过一番探索，你安全返回，带回了不少收获。`,
          `这次冒险虽然惊险，但结果令人满意。`,
        ]
      : [
          `探险失败了，你在${adventure.location}遇到了危险。`,
          `虽然没能达成目标，但你安全返回了。`,
          `这次冒险不太顺利，下次要更小心。`,
        ];
    return narratives[Math.floor(Math.random() * narratives.length)];
  }

  /**
   * Sync result generation (for RPC manual-complete without pre-provided result)
   */
  private _generateResultSync(adventure: Adventure): AdventureResult {
    const success = this._rollSuccess(adventure);
    const narrative = this._pickFallbackNarrative(adventure, success);
    const rewards = this._calculateRewards(adventure, success);
    return {
      success,
      narrative,
      rewards,
      damage: success ? undefined : 10,
    };
  }

  /**
   * Cancel an ongoing adventure
   */
  cancelAdventure(adventureId: string): { ok: boolean; reason?: string } {
    const adventure = this.adventures.get(adventureId);
    if (!adventure) {
      return { ok: false, reason: "Adventure not found" };
    }

    if (adventure.status !== "ongoing") {
      return { ok: false, reason: "Adventure not ongoing" };
    }

    adventure.status = "completed";
    adventure.endedAt = Date.now();
    adventure.result = {
      success: false,
      narrative: "探险被取消了。",
      rewards: { exp: 0, coins: 0 },
    };
    this.activeAdventureId = null;
    this._completing = false;
    this.save();

    this.bus.emit("adventure:cancelled", { adventure });

    return { ok: true };
  }

  /**
   * Tick - called periodically to check adventure completion.
   * Uses async LLM path for richer narratives; _completing flag prevents double-trigger.
   */
  tick(_deltaMs: number): void {
    if (!this.activeAdventureId || this._completing) return;

    const adventure = this.adventures.get(this.activeAdventureId);
    if (!adventure || adventure.status !== "ongoing") return;

    // Check if adventure duration has elapsed
    const elapsedMs = Date.now() - (adventure.startedAt ?? adventure.createdAt);
    const durationMs = adventure.duration * 60 * 1000;

    if (elapsedMs >= durationMs) {
      this._completing = true;
      // Async path: try LLM narrative, then finalize
      void this._completeWithLLM(adventure.id).catch(() => {
        // Absolute fallback: sync complete if async path explodes
        if (adventure.status === "ongoing") {
          this.completeAdventure(adventure.id);
        }
      });
    }
  }

  /**
   * Get adventure by ID
   */
  getAdventure(adventureId: string): Adventure | undefined {
    return this.adventures.get(adventureId);
  }

  /**
   * Get active adventure
   */
  getActiveAdventure(): Adventure | null {
    if (!this.activeAdventureId) return null;
    return this.adventures.get(this.activeAdventureId) ?? null;
  }

  /**
   * Get all adventures
   */
  getAdventures(): Adventure[] {
    return Array.from(this.adventures.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Get adventure history
   */
  getHistory(limit: number = 10): Adventure[] {
    return this.getAdventures()
      .filter((a) => a.status === "completed")
      .slice(0, limit);
  }

  /**
   * Get adventure stats
   */
  getStats(): {
    total: number;
    ongoing: number;
    completed: number;
    successRate: number;
  } {
    const all = this.getAdventures();
    const completed = all.filter((a) => a.status === "completed");
    const successful = completed.filter((a) => a.result?.success);

    return {
      total: all.length,
      ongoing: all.filter((a) => a.status === "ongoing").length,
      completed: completed.length,
      successRate: completed.length > 0 ? successful.length / completed.length : 0,
    };
  }
}
