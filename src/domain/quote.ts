import { object } from "./value.ts";

export interface Quote { cost: number; mode?: string; [key: string]: unknown }
export function validateQuote(value: unknown): Quote {
  const q = object(value);
  if (typeof q.cost !== "number" || !Number.isFinite(q.cost) || q.cost < 0) throw new Error("上游报价无效，未提交生成");
  return q as Quote;
}
export function quoteLabel(quote: Quote | null, count = 1): string {
  if (!quote) return "费用未知";
  if (quote.cost > 0) return `${Number((quote.cost * count).toFixed(2))} 积分`;
  return quote.mode === "unmetered" ? "不计额度" : `免费 ×${count}`;
}
export function costNotice(quote: Quote, shown: number | null, each = false): string {
  if (!(quote.cost > 0) || (typeof shown === "number" && quote.cost <= shown)) return "";
  const price = quoteLabel(quote) + (each ? "/张" : ""), scope = each ? "之后每张" : "本次";
  if (shown !== null && shown > 0) return `报价已变为 ${price}，${scope}按新报价生成`;
  return `${shown === 0 ? "免费额度已用完，" : ""}${scope}按积分计费（${price}）`;
}
/** One instance per logical batch, comparing against each preceding quote. */
export function createCostNotice(shown: number | null, each = false) {
  let lastCost = shown, announced = false;
  return (quote: Quote) => {
    const notice = announced ? "" : costNotice(quote, lastCost, each);
    if (notice) announced = true;
    lastCost = quote.cost;
    return notice;
  };
}
