import type { DesignTokenCategory, ScaleToken, TokenGroup, TokenScale } from "@unframed/contracts";
import type { DesignSystemIndex } from "../repoAnalysis/types.ts";
import type { TailwindToken } from "../tailwind.ts";

export type { DesignTokenCategory, ScaleToken, TokenGroup, TokenScale };

export interface CssSource {
  readonly file: string;
  readonly text: string;
}

export interface TokenScaleInput {
  readonly css: ReadonlyArray<CssSource>;
  readonly designSystem?: DesignSystemIndex | null;
}

export interface SnappedToken extends TailwindToken {
  readonly label: string;
  readonly px: number;
  readonly token: ScaleToken;
}

export interface BoundToken {
  readonly name: string;
  readonly label: string;
  readonly value: string;
  readonly token: ScaleToken | null;
}

export interface TokenOfInput {
  readonly computed: string;
  readonly className?: string | null;
  readonly authored?: string | null;
}

export const EMPTY_SCALE: TokenScale = { colors: [], colorGroups: [], spacing: [], sizes: [], radii: [], fontSizes: [], lineHeights: [], tracking: [], families: [], weights: [], shadows: [], other: [] };

export const tokenScaleOf = (_input: TokenScaleInput): TokenScale => EMPTY_SCALE;

export const tokensFor = (_scale: TokenScale, _property: string): ReadonlyArray<ScaleToken> => [];

export const classForToken = (_property: string, _token: ScaleToken): string | undefined => undefined;

export const snapToken = (_scale: TokenScale, _property: string, _px: number, _threshold?: number): SnappedToken | undefined => undefined;

export const tokenOf = (_scale: TokenScale, _property: string, _input: TokenOfInput): BoundToken | undefined => undefined;

export const tokenLabel = (_property: string, name: string): string => name;
