import { basename } from "node:path";
import type { Profile } from "../types.js";
import { sha256 } from "../util/hash.js";
import { DEFAULT_MODEL, DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE } from "../config-defaults.js";

export function parseProfileFile(filename: string, content: string): Profile {
  const id = basename(filename).replace(/\.(md|markdown|txt)$/i, "");
  const meta: Record<string, string> = {};
  let body = content;

  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (fm) {
    for (const line of fm[1]!.split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/);
      if (m) meta[m[1]!.toLowerCase()] = m[2]!.trim();
    }
    body = fm[2]!;
  }

  const systemPrompt = body.trim();
  const name = meta.name || id;
  const model = meta.model || DEFAULT_MODEL;
  const maxTokens = meta.maxtokens ? Number(meta.maxtokens) : DEFAULT_MAX_TOKENS;
  const temperature = meta.temperature !== undefined ? Number(meta.temperature) : DEFAULT_TEMPERATURE;
  const promptHash = sha256(`${systemPrompt}\n${model}\n${maxTokens}\n${temperature}`);

  return { id, name, systemPrompt, model, maxTokens, temperature, promptHash };
}
