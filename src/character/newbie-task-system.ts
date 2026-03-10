/**
 * Character Engine — NewbieTaskSystem
 *
 * Manages tutorial tasks for first-time users.
 * Design: Guide users to experience core capabilities in first session.
 * 
 * Goals:
 * 1. Help user succeed in first task (capability validation)
 * 2. Guide user through key features (feature discovery)
 * 3. Build habits early (retention)
 */

import type { EventBus } from "./event-bus.js";
import type { PersistenceStore } from "./attribute-engine.js";
import type { FirstTimeSystem, OnboardingStep } from "./first-time-system.js";

// ─── Types ───

export interface NewbieTask {
  id: string;
  title: string;
  description: string;
  hint: string;           // Hint text shown when user is stuck
  step: OnboardingStep;   // Linked onboarding step
  rewards: {
    exp?: number;
    coins?: number;
    itemId?: string;
  };
  completed: boolean;
  completedAt?: number;
}

// ─── Day 1 Tasks ───

/**
 * Newbie tasks for Day 1.
 * Ordered by difficulty, guide user through core capabilities.
 */
export const DAY1_TASKS: Omit<NewbieTask, "completed" | "completedAt">[] = [
  {
    id: "task-first-chat",
    title: "初次见面",
    description: "和宠物聊第一句话",
    hint: "试着和我说说话~",
    step: "first_chat" as OnboardingStep,
    rewards: { exp: 5, coins: 10 },
  },
  {
    id: "task-first-search",
    title: "搜索小能手",
    description: "让宠物帮你查一个问题",
    hint: "想查什么？问我试试！比如'今天天气怎么样'",
    step: "first_task_success" as OnboardingStep,
    rewards: { exp: 10, coins: 20 },
  },
  {
    id: "task-first-feed",
    title: "照顾新手",
    description: "给宠物喂第一次食",
    hint: "我饿了...点击喂食按钮，或者对我说'喂我吃东西'",
    step: "first_feed" as OnboardingStep,
    rewards: { exp: 5, coins: 15 },
  },
  {
    id: "task-online-10min",
    title: "陪伴时光",
    description: "在线陪伴宠物 10 分钟",
    hint: "多陪我一会儿嘛~",
    step: "onboarding_complete" as OnboardingStep, // Alternative completion
    rewards: { exp: 15, coins: 30 },
  },
];

// ─── Task Suggestions by Context ───

/**
 * Context-based task suggestions.
 * Help user who doesn't know what to do next.
 */
export const TASK_SUGGESTIONS = {
  after_welcome: [
    { action: "chat", examples: ["你好", "你是谁", "你能做什么"] },
    { action: "search", examples: ["今天天气怎么样", "最近有什么新闻"] },
    { action: "reminder", examples: ["提醒我明天开会", "记住我有重要会议"] },
  ],
  first_hunger: [
    { action: "feed", examples: ["喂我吃东西", "给我点吃的"] },
  ],
  task_complete: [
    { action: "continue", text: "还有什么要我帮忙的吗？" },
  ],
  idle: [
    { action: "chat", examples: ["随便聊聊", "你在干嘛"] },
    { action: "learn", examples: ["我想让你学点东西"] },
  ],
};

// ─── System ───

export class NewbieTaskSystem {
  private _bus: EventBus;
  private _store: PersistenceStore;
  private _firstTime: FirstTimeSystem;
  private _tasks: NewbieTask[] = [];

  constructor(bus: EventBus, store: PersistenceStore, firstTime: FirstTimeSystem) {
    this._bus = bus;
    this._store = store;
    this._firstTime = firstTime;
    this._load();
  }

  // ─── Queries ───

  /** Get all newbie tasks with completion status */
  getTasks(): NewbieTask[] {
    return this._tasks.map(task => ({
      ...task,
      completed: this._firstTime.isStepCompleted(task.step),
    }));
  }

  /** Get incomplete tasks */
  getIncompleteTasks(): NewbieTask[] {
    return this.getTasks().filter(t => !t.completed);
  }

  /** Get next recommended task */
  getNextTask(): NewbieTask | null {
    const incomplete = this.getIncompleteTasks();
    return incomplete.length > 0 ? incomplete[0] : null;
  }

  /** Get progress (0-1) */
  getProgress(): number {
    const total = this._tasks.length;
    const completed = this.getTasks().filter(t => t.completed).length;
    return total > 0 ? completed / total : 0;
  }

  // ─── Suggestions ───

  /** Get suggestions for current context */
  getSuggestions(context: keyof typeof TASK_SUGGESTIONS): typeof TASK_SUGGESTIONS[keyof typeof TASK_SUGGESTIONS] {
    return TASK_SUGGESTIONS[context] ?? [];
  }

  /** Get hint for current state */
  getCurrentHint(): string | null {
    const nextTask = this.getNextTask();
    return nextTask?.hint ?? null;
  }

  // ─── Rewards ───

  /** Calculate total pending rewards */
  getPendingRewards(): { exp: number; coins: number; items: string[] } {
    const incomplete = this.getIncompleteTasks();
    let exp = 0;
    let coins = 0;
    const items: string[] = [];

    for (const task of incomplete) {
      if (task.rewards.exp) exp += task.rewards.exp;
      if (task.rewards.coins) coins += task.rewards.coins;
      if (task.rewards.itemId) items.push(task.rewards.itemId);
    }

    return { exp, coins, items };
  }

  // ─── Persistence ───

  private _load(): void {
    // Initialize tasks from template
    this._tasks = DAY1_TASKS.map(t => ({
      ...t,
      completed: false,
    }));

    // Note: completion status is derived from FirstTimeSystem
    // So we don't need to persist separately
  }
}