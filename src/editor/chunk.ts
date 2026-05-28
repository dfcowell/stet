const CHARS_PER_TOKEN = 4;
const SAFETY = 0.8; // leave headroom under the output-token budget

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function chunkByBudget(rawText: string, maxOutputTokens: number): string[] {
  const budget = Math.max(1, Math.floor(maxOutputTokens * SAFETY));
  if (estimateTokens(rawText) <= budget) return [rawText];

  const paras = rawText.split(/\n{2,}/);
  const chunks: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const para of paras) {
    const t = estimateTokens(para);
    if (current.length > 0 && currentTokens + t > budget) {
      chunks.push(current.join("\n\n"));
      current = [];
      currentTokens = 0;
    }
    current.push(para);
    currentTokens += t;
  }
  if (current.length > 0) chunks.push(current.join("\n\n"));
  return chunks;
}
