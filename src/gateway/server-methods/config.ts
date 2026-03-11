/**
 * Config RPC methods
 * 
 * Help new users configure their AI model provider.
 * Provides:
 * - Configuration status check
 * - Configuration wizard data
 * - Configuration test
 */

import type { GatewayConfig } from "@openclaw/core";
import { getAvailableProviders, testProviderConnection } from "../config/providers.js";

// ─── Types ───

export interface ConfigStatus {
  configured: boolean;
  provider?: string;
  model?: string;
  needsSetup: boolean;
}

export interface ProviderInfo {
  id: string;
  name: string;
  url: string;
  description: string;
  recommended?: boolean;
  requiresApiKey: boolean;
  models?: string[];
}

// ─── Provider List ───

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "openrouter",
    name: "OpenRouter",
    url: "https://openrouter.ai",
    description: "支持多种模型，价格便宜，推荐新手使用",
    recommended: true,
    requiresApiKey: true,
    models: ["auto", "anthropic/claude-3.5-sonnet", "openai/gpt-4o", "google/gemini-2.0-flash"],
  },
  {
    id: "openai",
    name: "OpenAI",
    url: "https://platform.openai.com",
    description: "ChatGPT 官方 API，质量稳定",
    requiresApiKey: true,
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    url: "https://console.anthropic.com",
    description: "Claude 官方 API，擅长长文本和推理",
    requiresApiKey: true,
    models: ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022"],
  },
  {
    id: "ollama",
    name: "本地模型 (Ollama)",
    url: "http://localhost:11434",
    description: "完全本地运行，隐私安全，需要安装 Ollama",
    requiresApiKey: false,
    models: ["llama3.2", "qwen2.5", "deepseek-r1"],
  },
];

// ─── RPC Handlers ───

export const configMethods = {
  /**
   * Get configuration status.
   * Returns whether API is configured and ready to use.
   */
  "character.config.status": async (): Promise<ConfigStatus> => {
    try {
      const providers = await getAvailableProviders();
      if (providers.length === 0) {
        return { configured: false, needsSetup: true };
      }
      
      const primary = providers[0];
      return {
        configured: true,
        provider: primary.provider,
        model: primary.model,
        needsSetup: false,
      };
    } catch {
      return { configured: false, needsSetup: true };
    }
  },

  /**
   * Get configuration wizard data.
   * Returns list of available providers and their info.
   */
  "character.config.wizard": async () => ({
    providers: PROVIDERS,
    recommended: "openrouter",
    helpUrl: "https://docs.openclaw.ai/docs/configuration",
  }),

  /**
   * Test provider configuration.
   * Attempts to connect with the provided credentials.
   */
  "character.config.test": async (params: {
    provider: string;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  }): Promise<{ success: boolean; error?: string; models?: string[] }> => {
    const { provider, apiKey, baseUrl, model } = params;
    
    try {
      const result = await testProviderConnection({
        provider,
        apiKey,
        baseUrl,
        model: model ?? "auto",
      });
      
      return {
        success: result.success,
        error: result.error,
        models: result.models,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  },

  /**
   * Get provider-specific help.
   * Returns setup instructions for a provider.
   */
  "character.config.help": async (params: { provider: string }) => {
    const provider = PROVIDERS.find(p => p.id === params.provider);
    if (!provider) {
      return { error: "Provider not found" };
    }
    
    return {
      provider: provider.id,
      name: provider.name,
      url: provider.url,
      steps: getSetupSteps(provider.id),
    };
  },
};

// ─── Setup Steps ───

function getSetupSteps(providerId: string): string[] {
  switch (providerId) {
    case "openrouter":
      return [
        "1. 访问 https://openrouter.ai 并注册账号",
        "2. 在 Settings → Keys 页面创建 API Key",
        "3. 复制 API Key（以 sk-or- 开头）",
        "4. 粘贴到下方输入框",
        "5. 选择默认模型（推荐 auto）",
        "6. 点击测试连接",
      ];
    case "openai":
      return [
        "1. 访问 https://platform.openai.com 并登录",
        "2. 在 API Keys 页面创建新的 Key",
        "3. 复制 API Key（以 sk- 开头）",
        "4. 粘贴到下方输入框",
        "5. 选择模型",
        "6. 点击测试连接",
      ];
    case "anthropic":
      return [
        "1. 访问 https://console.anthropic.com 并登录",
        "2. 在 API Keys 页面创建新的 Key",
        "3. 复制 API Key",
        "4. 粘贴到下方输入框",
        "5. 选择模型",
        "6. 点击测试连接",
      ];
    case "ollama":
      return [
        "1. 安装 Ollama: https://ollama.ai",
        "2. 运行 'ollama pull llama3.2' 下载模型",
        "3. 确保 Ollama 服务在运行（默认端口 11434）",
        "4. 选择已下载的模型",
        "5. 点击测试连接",
      ];
    default:
      return ["请参考官方文档配置"];
  }
}