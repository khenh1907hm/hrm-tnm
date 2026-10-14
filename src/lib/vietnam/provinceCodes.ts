// TODO: replace the permitted-range placeholder with the official province code registry.
export const PROVINCE_CODES = new Set(Array.from({ length: 96 }, (_, index) => String(index + 1).padStart(3, "0")));
