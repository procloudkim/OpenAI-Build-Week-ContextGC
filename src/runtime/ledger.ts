import { randomUUID } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname } from "node:path";

import { RuntimeIntegrityError } from "./errors.js";
import { isRecord } from "./io.js";
import { redactJson } from "./redaction.js";
import type { JsonValue, LedgerRecord } from "./types.js";

export class JsonlLedger {
  readonly path: string;
  #appendQueue: Promise<unknown> = Promise.resolve();

  constructor(path: string) {
    this.path = path;
  }

  async init(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const handle = await open(this.path, "a", 0o600);
    await handle.close();
  }

  async append<TPayload extends JsonValue>(type: string, payload: TPayload): Promise<LedgerRecord<TPayload>> {
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(type)) {
      throw new TypeError("Ledger event type must be a bounded identifier");
    }

    const record: LedgerRecord<TPayload> = {
      schemaVersion: 1,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type,
      payload: redactJson(payload).value,
    };

    const operation = this.#appendQueue.then(async () => {
      await this.init();
      const handle = await open(this.path, "a", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
    });
    this.#appendQueue = operation.catch(() => undefined);
    await operation;
    return record;
  }

  async readAll(): Promise<readonly LedgerRecord[]> {
    await this.init();
    const content = await readFile(this.path, "utf8");
    if (content === "") return [];

    const lines = content.split("\n");
    if (lines.at(-1) !== "") {
      throw new RuntimeIntegrityError("Ledger ends with an incomplete JSONL record");
    }

    return lines.slice(0, -1).map((line, index) => {
      let value: unknown;
      try {
        value = JSON.parse(line) as unknown;
      } catch {
        throw new RuntimeIntegrityError(`Ledger record ${index + 1} is not valid JSON`);
      }
      if (!isLedgerRecord(value)) {
        throw new RuntimeIntegrityError(`Ledger record ${index + 1} has an unknown schema`);
      }
      return value;
    });
  }
}

function isLedgerRecord(value: unknown): value is LedgerRecord {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    typeof value.id === "string" &&
    typeof value.timestamp === "string" &&
    typeof value.type === "string" &&
    "payload" in value
  );
}
