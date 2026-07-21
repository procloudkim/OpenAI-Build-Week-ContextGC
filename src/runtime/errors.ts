export class RuntimeIntegrityError extends Error {
  override readonly name = "RuntimeIntegrityError";
}

export class RuntimeNotFoundError extends Error {
  override readonly name = "RuntimeNotFoundError";
}

export class RuntimeCapacityError extends Error {
  override readonly name = "RuntimeCapacityError";
}

export class TranscriptSchemaError extends Error {
  override readonly name = "TranscriptSchemaError";
}
