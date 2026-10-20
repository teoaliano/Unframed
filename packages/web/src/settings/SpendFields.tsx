/**
 * The spend limit fields of an outside connection: an amount in US
 * dollars and a period, neither filled in by default. An empty amount is no limit.
 */
import { spendLimitProblem, SPEND_PERIODS, type SpendPeriod } from "@unframed/domain";
import type { SpendLimit } from "@unframed/contracts";
import { useId } from "react";
import { Input } from "~/components/ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";

export const PERIOD_LABELS: Record<SpendPeriod, string> = { day: "Per day", week: "Per week", month: "Per month", lifetime: "For its whole life" };

/** The limit the fields say, or the sentence for what they cannot say (`null` limit: no limit). */
export const parseSpendLimit = (amount: string, period: SpendPeriod | undefined): { readonly ok: true; readonly limit: SpendLimit | null } | { readonly ok: false; readonly message: string } => {
  const text = amount.trim();
  if (text === "") return { ok: true, limit: null };
  const usd = Number(text);
  const problem = spendLimitProblem({ usd: Number.isNaN(usd) ? Number.NaN : usd, period });
  if (problem !== undefined) return { ok: false, message: problem };
  return { ok: true, limit: { usd, period: period! } };
};

export const SpendFields = ({
  amount,
  period,
  onAmount,
  onPeriod,
}: {
  readonly amount: string;
  readonly period: SpendPeriod | undefined;
  readonly onAmount: (amount: string) => void;
  readonly onPeriod: (period: SpendPeriod) => void;
}) => {
  const periodId = useId();
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-muted-foreground">Spend limit, in US dollars</span>
        <Input aria-label="Spend limit amount" inputMode="decimal" placeholder="No limit" value={amount} onChange={(event) => onAmount(event.target.value)} />
      </label>
      <div className="flex flex-col gap-1.5 text-sm">
        <span id={periodId} className="text-muted-foreground">
          Limit period
        </span>
        <Select value={period ?? ""} onValueChange={(value) => value && onPeriod(value as SpendPeriod)}>
          <SelectTrigger aria-labelledby={periodId}>
            <SelectValue>{period === undefined ? "Choose a period" : PERIOD_LABELS[period]}</SelectValue>
          </SelectTrigger>
          <SelectPopup alignItemWithTrigger={false}>
            {SPEND_PERIODS.map((option) => (
              <SelectItem key={option} value={option}>
                {PERIOD_LABELS[option]}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
    </div>
  );
};
