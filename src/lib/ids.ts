export interface IdGenerator {
  next(): string;
}

export function sequentialIds(prefix = "id"): IdGenerator {
  let nextId = 0;
  return { next: () => `${prefix}_${++nextId}` };
}
