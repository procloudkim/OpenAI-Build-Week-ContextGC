import type { JsonValue } from "./types.js";

export interface RedactionResult<T> {
  readonly value: T;
  readonly count: number;
}

const SECRET_KEY = /^(?:api[_-]?key|access[_-]?token|auth(?:orization)?|client[_-]?secret|password|private[_-]?key|refresh[_-]?token|secret|token)$/i;

const PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, "[REDACTED:private-key]"],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[REDACTED:openai-key]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[REDACTED:github-token]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED:aws-access-key]"],
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*\b/gi, "Bearer [REDACTED:bearer-token]"],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED:jwt]"],
  [/(\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|refresh[_-]?token|secret|token)\b\s*[:=]\s*["']?)[^\s"',;}]+/gi, "$1[REDACTED:value]"],
  [/\bfile:[^\s"'<>]+/gi, "[REDACTED:file-uri]"],
  [/\bfile%3a[^\s"'<>]+/gi, "[REDACTED:file-uri]"],
  [/\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+\b/gi, "[REDACTED:email]"],
  [/\b([A-Z]:[\\/]+Users[\\/]+)(?!\[REDACTED:user\])[^\\/\s"'<>:|?*]+/gi, "$1[REDACTED:user]"],
  [/(?<![A-Za-z0-9._~:/-])(\/(?:Users|home)\/)(?!\[REDACTED:user\])[^/\s"'<>]+/g, "$1[REDACTED:user]"],
  [/(?<![A-Za-z0-9_])\+(?:\d[\s().-]*){8,14}\d(?![A-Za-z0-9_])/g, "[REDACTED:phone]"],
  [/(?<![A-Za-z0-9_])(?:\(\d{2,4}\)|\d{2,4})[ .-]\d{3,4}[ .-]\d{4}(?![A-Za-z0-9_])/g, "[REDACTED:phone]"],
];

export function redactText(input: string): RedactionResult<string> {
  let value = input;
  let count = 0;

  for (const [pattern, replacement] of PATTERNS) {
    count += value.match(pattern)?.length ?? 0;
    value = value.replace(pattern, replacement);
  }

  return { value, count };
}

export function redactJson<T extends JsonValue>(input: T): RedactionResult<T> {
  let count = 0;

  const visit = (value: JsonValue, key?: string): JsonValue => {
    if (key !== undefined && SECRET_KEY.test(key) && value !== null) {
      count += 1;
      return "[REDACTED:secret-field]";
    }

    if (typeof value === "string") {
      const redacted = redactText(value);
      count += redacted.count;
      return redacted.value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => visit(item));
    }

    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([childKey, childValue]) => [childKey, visit(childValue, childKey)]),
      );
    }

    return value;
  };

  return { value: visit(input) as T, count };
}
