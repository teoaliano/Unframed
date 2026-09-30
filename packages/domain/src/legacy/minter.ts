import { refTokens } from "../refs.ts";

const NUMERIC = /^\d+$/;

/**
 * Spec 02's `nextRef` over an old graph while it is being imported: one past the largest
 * numeric id and numeric `@` token, and 99, counting every ref minted so far. `texts` are
 * every text that will be a prompt on the new canvas, answers included.
 */
export class RefMinter {
  private largest = 99n;

  constructor(ids: Iterable<string>, texts: Iterable<string>) {
    for (const id of ids) this.consider(id);
    for (const text of texts) for (const token of refTokens(text)) this.consider(token);
  }

  private consider(candidate: string): void {
    if (!NUMERIC.test(candidate)) return;
    const value = BigInt(candidate);
    if (value > this.largest) this.largest = value;
  }

  mint(): string {
    this.largest += 1n;
    return this.largest.toString();
  }
}
