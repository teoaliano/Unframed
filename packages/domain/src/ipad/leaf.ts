export const LEAF_RENEWAL_DAYS = 30;

export interface LeafFacts {
  readonly san: string;
  readonly notAfter: Date;
}

export const leafNeedsRenewal = (leaf: LeafFacts, localName: string, now: Date): boolean => {
  if (leaf.san.toLowerCase() !== localName.toLowerCase()) return true;
  return leaf.notAfter.getTime() - now.getTime() < LEAF_RENEWAL_DAYS * 24 * 60 * 60 * 1000;
};
