import { sha256 } from "./hash.js";

export function computeCacheKey(args: {
  url: string;
  profileId: string;
  promptHash: string;
  model: string;
}): string {
  return sha256(`${args.url}\n${args.profileId}\n${args.promptHash}\n${args.model}`);
}
