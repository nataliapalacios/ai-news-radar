import type { Config } from "../config/schema.js";
import { ClaudeLlm } from "./claude.js";
import { MockLlm } from "./mock.js";
import type { Llm } from "./types.js";

export function makeLlm(cfg: Config): Llm {
  return process.env.MOCK_LLM === "1" ? new MockLlm() : new ClaudeLlm(cfg.models);
}
