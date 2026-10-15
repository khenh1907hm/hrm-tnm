export interface IdGenerator {
  next(): string;
}

export function sequentialIds(prefix = "id"): IdGenerator {
  let nextId = 0;
  return { next: () => `${prefix}_${++nextId}` };
}

/** Id ngẫu nhiên (UUID) — dùng khi nhiều người/nhiều phiên cùng ghi vào một cơ sở dữ liệu. */
export function randomIds(): IdGenerator {
  return { next: () => crypto.randomUUID() };
}
