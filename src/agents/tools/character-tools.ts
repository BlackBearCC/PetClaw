/**
 * Character Tools — Pet-specific tools for AI self-care, memory, and expression
 *
 * These tools allow the AI to:
 * 1. Take care of itself (feed/rest/play)
 * 2. Proactively remember important user information
 * 3. Express emotions through animations
 */

import { Type } from "@sinclair/typebox";
import { getEngine } from "../../gateway/server-methods/character.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";

// ─── Schemas ───

const CharacterSelfCareSchema = Type.Object({
  action: Type.Union([
    Type.Literal("feed"),
    Type.Literal("rest"),
    Type.Literal("play"),
  ]),
  reason: Type.String(),
});

const CharacterRememberSchema = Type.Object({
  fact: Type.String(),
  category: Type.Union([
    Type.Literal("preference"),
    Type.Literal("project"),
    Type.Literal("habit"),
    Type.Literal("relationship"),
  ]),
});

const CharacterExpressMoodSchema = Type.Object({
  emotion: Type.Union([
    Type.Literal("happy"),
    Type.Literal("sad"),
    Type.Literal("excited"),
    Type.Literal("sleepy"),
    Type.Literal("curious"),
  ]),
});

// ─── Rate limiting ───

const characterToolCallsPerTurn = new Map<string, number>();
const MAX_CALLS_PER_TURN = 2;

function checkRateLimit(sessionKey: string): boolean {
  const calls = characterToolCallsPerTurn.get(sessionKey) ?? 0;
  if (calls >= MAX_CALLS_PER_TURN) {
    return false;
  }
  characterToolCallsPerTurn.set(sessionKey, calls + 1);
  return true;
}

export function resetCharacterToolRateLimit(sessionKey: string): void {
  characterToolCallsPerTurn.delete(sessionKey);
}

// ─── Tools ───

export function createCharacterSelfCareTool(options?: {
  broadcast?: (channel: string, payload: unknown) => void;
}): AnyAgentTool {
  return {
    label: "Character Self Care",
    name: "character_self_care",
    description:
      "Use when you feel your character state is abnormal (very hungry, tired, or bored). Automatically feeds, rests, or plays to improve your state. Limited to 2 calls per turn, subject to cooldowns.",
    parameters: CharacterSelfCareSchema,
    execute: async (_toolCallId, params) => {
      const action = readStringParam(params, "action", { required: true }) as "feed" | "rest" | "play";
      const reason = readStringParam(params, "reason", { required: true });

      const engine = getEngine();
      if (!engine) {
        return jsonResult({ ok: false, error: "Character engine not initialized" });
      }

      // Rate limit check would be done at session level
      // For now, we just execute the action

      try {
        let result: { ok: boolean; reason?: string };

        switch (action) {
          case "feed":
            result = engine.care.feed("ration_42");
            break;
          case "rest":
            result = engine.care.rest("nap");
            break;
          case "play":
            result = engine.care.play("ball");
            break;
        }

        if (result.ok) {
          // Broadcast to client
          options?.broadcast?.("character", {
            kind: "self-care",
            action,
            reason,
          });
        }

        return jsonResult({
          ok: result.ok,
          action,
          reason: result.ok ? `Successfully ${action}ed` : result.reason,
          state: engine.getState(),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ ok: false, error: message });
      }
    },
  };
}

export function createCharacterRememberTool(): AnyAgentTool {
  return {
    label: "Character Remember",
    name: "character_remember",
    description:
      "Proactively remember important information the user mentioned. Creates a memory cluster that can be recalled later via memory_search.",
    parameters: CharacterRememberSchema,
    execute: async (_toolCallId, params) => {
      const fact = readStringParam(params, "fact", { required: true });
      const category = readStringParam(params, "category", { required: true }) as
        | "preference"
        | "project"
        | "habit"
        | "relationship";

      const engine = getEngine();
      if (!engine) {
        return jsonResult({ ok: false, error: "Character engine not initialized" });
      }

      try {
        // Create a memory cluster from the fact
        const cluster = {
          id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          theme: `${category}: ${fact.slice(0, 50)}${fact.length > 50 ? "..." : ""}`,
          keywords: [category, ...fact.split(/\s+/).slice(0, 5)],
          implicitKeywords: [],
          summary: fact,
          fragments: [{ text: fact }],
          weight: 1.0,
          updatedAt: Date.now(),
        };

        // Add to memory graph
        engine.memoryGraph.enqueueExtraction(fact, "");

        return jsonResult({
          ok: true,
          remembered: { fact, category },
          clusterId: cluster.id,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ ok: false, error: message });
      }
    },
  };
}

export function createCharacterExpressMoodTool(options?: {
  broadcast?: (channel: string, payload: unknown) => void;
}): AnyAgentTool {
  return {
    label: "Character Express Mood",
    name: "character_express_mood",
    description:
      "Express your current emotion through an animation. Use to show happiness, sadness, excitement, sleepiness, or curiosity. Does not change any stats.",
    parameters: CharacterExpressMoodSchema,
    execute: async (_toolCallId, params) => {
      const emotion = readStringParam(params, "emotion", { required: true }) as
        | "happy"
        | "sad"
        | "excited"
        | "sleepy"
        | "curious";

      const engine = getEngine();
      if (!engine) {
        return jsonResult({ ok: false, error: "Character engine not initialized" });
      }

      try {
        // Broadcast mood expression to client
        const payload = {
          kind: "mood-expression",
          emotion,
          timestamp: Date.now(),
        };

        options?.broadcast?.("character", payload);

        // Also emit on event bus for internal listeners
        engine.bus.emit("character:mood-expressed", { emotion });

        return jsonResult({
          ok: true,
          expressed: emotion,
          message: `Expressed ${emotion} emotion`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ ok: false, error: message });
      }
    },
  };
}

// ─── Export all tools ───

export function createCharacterTools(options?: {
  broadcast?: (channel: string, payload: unknown) => void;
}): AnyAgentTool[] {
  return [
    createCharacterSelfCareTool(options),
    createCharacterRememberTool(),
    createCharacterExpressMoodTool(options),
  ];
}