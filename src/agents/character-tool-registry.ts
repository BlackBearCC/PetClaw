/**
 * Character Tool Registry — neutral layer between gateway (character engine)
 * and agents (tool construction).  Avoids a direct gateway→agents import cycle.
 *
 * Usage:
 *   Gateway: registerCharacterTools(createCharacterTools({ engine, broadcast }))
 *   Agents:  getCharacterTools() → spread into tool list
 */

import type { AnyAgentTool } from "./tools/common.js";

let _tools: AnyAgentTool[] = [];

export function registerCharacterTools(tools: AnyAgentTool[]): void {
  _tools = tools;
}

export function getCharacterTools(): AnyAgentTool[] {
  return _tools;
}
