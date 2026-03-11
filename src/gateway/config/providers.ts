/**
 * Provider utilities for configuration.
 * 
 * Provides:
 * - List available providers
 * - Test provider connection
 */

// ─── Types ───

export interface ProviderConfig {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface ProviderStatus {
  provider: string;
  model: string;
  configured: boolean;
}

export interface TestResult {
  success: boolean;
  error?: string;
  models?: string[];
}

// ─── Provider Detection ───

/**
 * Get list of configured providers.
 * Checks environment variables and config files.
 */
export async function getAvailableProviders(): Promise<ProviderStatus[]> {
  const providers: ProviderStatus[] = [];
  
  // Check OpenRouter
  if (process.env.OPENROUTER_API_KEY) {
    providers.push({
      provider: "openrouter",
      model: process.env.OPENROUTER_MODEL ?? "auto",
      configured: true,
    });
  }
  
  // Check OpenAI
  if (process.env.OPENAI_API_KEY) {
    providers.push({
      provider: "openai",
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      configured: true,
    });
  }
  
  // Check Anthropic
  if (process.env.ANTHROPIC_API_KEY) {
    providers.push({
      provider: "anthropic",
      model: process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-20241022",
      configured: true,
    });
  }
  
  // Check Ollama (local)
  try {
    const response = await fetch("http://localhost:11434/api/tags", {
      method: "GET",
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) {
      providers.push({
        provider: "ollama",
        model: "llama3.2",
        configured: true,
      });
    }
  } catch {
    // Ollama not running
  }
  
  return providers;
}

// ─── Connection Test ───

/**
 * Test provider connection.
 * Attempts a minimal API call to verify credentials.
 */
export async function testProviderConnection(config: ProviderConfig): Promise<TestResult> {
  const { provider, apiKey, baseUrl, model } = config;
  
  try {
    switch (provider) {
      case "openrouter":
        return await testOpenRouter(apiKey ?? "", model);
      case "openai":
        return await testOpenAI(apiKey ?? "", model);
      case "anthropic":
        return await testAnthropic(apiKey ?? "", model);
      case "ollama":
        return await testOllama(baseUrl ?? "http://localhost:11434", model);
      default:
        return { success: false, error: "Unknown provider" };
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Connection failed",
    };
  }
}

// ─── Provider-specific Tests ───

async function testOpenRouter(apiKey: string, model: string): Promise<TestResult> {
  if (!apiKey || !apiKey.startsWith("sk-or-")) {
    return { success: false, error: "Invalid API Key format (should start with sk-or-)" };
  }
  
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model || "openai/gpt-4o-mini",
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(10000),
    });
    
    if (response.ok) {
      return { success: true };
    }
    
    const error = await response.json();
    return {
      success: false,
      error: error.error?.message ?? `HTTP ${response.status}`,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Connection failed",
    };
  }
}

async function testOpenAI(apiKey: string, model: string): Promise<TestResult> {
  if (!apiKey || !apiKey.startsWith("sk-")) {
    return { success: false, error: "Invalid API Key format (should start with sk-)" };
  }
  
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model || "gpt-4o-mini",
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(10000),
    });
    
    if (response.ok) {
      return { success: true };
    }
    
    const error = await response.json();
    return {
      success: false,
      error: error.error?.message ?? `HTTP ${response.status}`,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Connection failed",
    };
  }
}

async function testAnthropic(apiKey: string, model: string): Promise<TestResult> {
  if (!apiKey) {
    return { success: false, error: "API Key is required" };
  }
  
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model || "claude-3-5-haiku-20241022",
        max_tokens: 1,
        messages: [{ role: "user", content: "Hi" }],
      }),
      signal: AbortSignal.timeout(10000),
    });
    
    if (response.ok) {
      return { success: true };
    }
    
    const error = await response.json();
    return {
      success: false,
      error: error.error?.message ?? `HTTP ${response.status}`,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Connection failed",
    };
  }
}

async function testOllama(baseUrl: string, model: string): Promise<TestResult> {
  try {
    // First check if Ollama is running
    const tagsResponse = await fetch(`${baseUrl}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    
    if (!tagsResponse.ok) {
      return { success: false, error: "Ollama service not responding" };
    }
    
    const tags = await tagsResponse.json();
    const models = tags.models?.map((m: any) => m.name) ?? [];
    
    // Check if model exists
    if (model && !models.some((m: string) => m.startsWith(model))) {
      return {
        success: false,
        error: `Model '${model}' not found. Available: ${models.slice(0, 3).join(", ")}...`,
        models,
      };
    }
    
    return { success: true, models };
  } catch (err) {
    return {
      success: false,
      error: "Ollama not running. Start with: ollama serve",
    };
  }
}