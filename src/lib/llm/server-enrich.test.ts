import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DEAL_EXTRACTION_JSON_SCHEMA,
  checkUserRateLimit,
  llmProviderConfig,
  resetRateLimiterForTests,
} from "./server-enrich";

describe("llm/server-enrich", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetRateLimiterForTests();
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_MODEL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("reports unconfigured gracefully when no LLM provider key is set", () => {
    const config = llmProviderConfig();
    expect(config.configured).toBe(false);
    if (!config.configured) {
      expect(config.message).toContain("no LLM provider key");
    }
  });

  it("enforces the per-user 5 calls / 60s sliding-window rate limit", () => {
    const base = 1_700_000_000_000;
    for (let i = 0; i < 5; i += 1) {
      expect(checkUserRateLimit("user-1", base + i * 1000)).toEqual({
        allowed: true,
      });
    }
    const blocked = checkUserRateLimit("user-1", base + 10_000);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.retryAfterSec).toBeGreaterThanOrEqual(50);
    }

    // Another user is unaffected
    expect(checkUserRateLimit("user-2", base + 10_000)).toEqual({
      allowed: true,
    });

    // After 60 seconds, user-1 is allowed again
    expect(checkUserRateLimit("user-1", base + 60_001)).toEqual({
      allowed: true,
    });
  });

  it("keeps DEAL_EXTRACTION_JSON_SCHEMA compatible with OpenAI strict mode", () => {
    const visit = (node: Record<string, unknown>, path: string) => {
      if (node.type === "object") {
        expect(node.additionalProperties, `${path}.additionalProperties`).toBe(false);
        const props = node.properties as Record<string, Record<string, unknown>>;
        const required = node.required as string[];
        expect(new Set(required), `${path}.required`).toEqual(
          new Set(Object.keys(props)),
        );
        for (const [k, v] of Object.entries(props)) {
          visit(v, `${path}.${k}`);
        }
      }
      if (node.type === "array" && node.items && typeof node.items === "object") {
        visit(node.items as Record<string, unknown>, `${path}[]`);
      }
      for (const disallowed of ["maxLength", "minLength", "minimum", "maximum"]) {
        expect(node, `${path} must not contain ${disallowed}`).not.toHaveProperty(
          disallowed,
        );
      }
    };

    visit(DEAL_EXTRACTION_JSON_SCHEMA as unknown as Record<string, unknown>, "root");
    expect(DEAL_EXTRACTION_JSON_SCHEMA.properties.evidence.type).toBe("array");
  });
});
