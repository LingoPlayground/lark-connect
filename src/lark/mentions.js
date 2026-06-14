export const MAX_MENTION_TARGETS = 20;
export const MAX_MENTION_OPEN_ID_LENGTH = 128;
export const MAX_MENTION_NAME_LENGTH = 80;

const SAFE_OPEN_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function hasUnsafeMentionNameCharacter(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (character === "<" || character === ">" || character === "&") return true;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

function normalizeMentionTarget(target) {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new Error("mentions items must be objects");
  }

  const openId = String(target.openId ?? target.open_id ?? "").trim();
  if (!openId) throw new Error("mentions.openId is required");
  if (openId.length > MAX_MENTION_OPEN_ID_LENGTH) {
    throw new Error(`mentions.openId must be at most ${MAX_MENTION_OPEN_ID_LENGTH} characters`);
  }
  if (!SAFE_OPEN_ID_PATTERN.test(openId)) {
    throw new Error("mentions.openId must contain only letters, numbers, underscores, or hyphens");
  }

  const mention = { openId };
  const name = String(target.name ?? "").trim();
  if (name) {
    if (name.length > MAX_MENTION_NAME_LENGTH) {
      throw new Error(`mentions.name must be at most ${MAX_MENTION_NAME_LENGTH} characters`);
    }
    if (hasUnsafeMentionNameCharacter(name)) {
      throw new Error("mentions.name must not contain tag control characters");
    }
    mention.name = name;
  }
  if (target.isBot !== undefined) {
    if (typeof target.isBot !== "boolean") throw new Error("mentions.isBot must be a boolean");
    mention.isBot = target.isBot;
  }
  return mention;
}

export function normalizeOptionalMentions(mentions) {
  if (mentions === undefined) return undefined;
  if (!Array.isArray(mentions)) throw new Error("mentions must be an array");
  if (mentions.length > MAX_MENTION_TARGETS) {
    throw new Error(`mentions cannot include more than ${MAX_MENTION_TARGETS} targets`);
  }
  const normalized = mentions.map(normalizeMentionTarget);
  return normalized.length > 0 ? normalized : undefined;
}
