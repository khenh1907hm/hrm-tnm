import { normalizeCertificateTitle } from "./rules";

export function hasValidRenewalIdentity(currentType: string, currentTitle: string, nextType: string, nextTitle: string): boolean {
  return currentType === nextType && normalizeCertificateTitle(currentTitle) === normalizeCertificateTitle(nextTitle);
}
