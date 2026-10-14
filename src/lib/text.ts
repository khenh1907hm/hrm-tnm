export function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase().trim().replace(/\s+/g, " ");
}

export function compareNormalizedText(a: string, b: string): number {
  const normalizedA = normalizeText(a);
  const normalizedB = normalizeText(b);
  return normalizedA < normalizedB ? -1 : normalizedA > normalizedB ? 1 : 0;
}

export function compareCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function naturalCompare(a: string, b: string): number {
  const left = normalizeText(a).match(/\d+|\D+/g) ?? [];
  const right = normalizeText(b).match(/\d+|\D+/g) ?? [];
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index]!;
    const rightPart = right[index]!;
    const leftDigits = /^\d+$/.test(leftPart);
    const rightDigits = /^\d+$/.test(rightPart);
    let comparison: number;
    if (leftDigits && rightDigits) {
      const leftNumber = leftPart.replace(/^0+(?=\d)/, "");
      const rightNumber = rightPart.replace(/^0+(?=\d)/, "");
      comparison = leftNumber.length - rightNumber.length || (leftNumber < rightNumber ? -1 : leftNumber > rightNumber ? 1 : 0);
    } else {
      comparison = compareNormalizedText(leftPart, rightPart);
    }
    if (comparison !== 0) return comparison;
  }
  return left.length - right.length;
}
