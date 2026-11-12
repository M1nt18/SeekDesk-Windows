import Decimal from 'decimal.js';
import type {RemainingValueInput, RemainingValueResult} from '../shared/parity';

const Money = Decimal.clone({precision: 48, rounding: Decimal.ROUND_HALF_UP});
export const supportedCurrencies = new Set('CNY USD HKD EUR JPY GBP SGD TWD KRW AED ARS AUD BRL CAD CHF CLP CZK DKK HUF IDR ILS INR MXN MYR NOK NZD PHP PLN RON SAR SEK THB TRY UAH VND ZAR'.split(' '));
export const cycleMonths = [1, 3, 6, 12, 24, 36];
export function parseValue(input: string): Decimal {
  const value = typeof input === 'string' ? input.trim() : '';
  if (value.length > 32 || !/^(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{0,12})?|\.\d{1,12})$/.test(value)) throw new Error('请输入非负金额，最多保留 12 位小数。');
  return new Money(value.replace(/,/g, ''));
}
export function moneyDigits(currency: string): number {return ['JPY','KRW','VND','CLP'].includes(currency) ? 0 : 2;}
export function formatMoney(value: Decimal.Value, currency: string): string {return new Money(value).toFixed(moneyDigits(currency));}
function exchangeValue(input:string):Decimal {
  const value=input.trim();
  if(value.length>64||!/^(?:\d+(?:\.\d{0,24})?|\.\d{1,24})$/.test(value))throw new Error('请输入有效的正汇率。');
  const rate=new Money(value);if(!rate.isPositive())throw new Error('汇率必须大于零。');return rate;
}
function calendarDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(value);
  if (!match) throw new Error('日期格式应为 YYYY-MM-DD。');
  const [year, month, day] = match.slice(1).map(Number), date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new Error('日期无效。');
  return date;
}
function subtractMonths(anchor: Date, months: number): Date {
  const month = anchor.getUTCMonth() - months;
  const first = new Date(Date.UTC(anchor.getUTCFullYear(), month, 1));
  const end = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(anchor.getUTCDate(), end.getUTCDate())));
}
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86400000);
export function remainingEstimate(amount: string, months: number, asOf: string, expires: string) {
  if (!cycleMonths.includes(months)) throw new Error('续费周期应为 1、3、6、12、24 或 36 个月。');
  const renewal = parseValue(amount), today = calendarDate(asOf), end = calendarDate(expires), days = daysBetween(today, end);
  if (days <= 0) return {days: 0, fullCycles: 0, partialDays: 0, partialCycleDays: 0, amount: new Money(0)};
  let upper = end;
  for (let complete = 0; complete < 1200; complete++) {
    const lower = subtractMonths(end, (complete + 1) * months);
    if (today >= lower) {
      const partial = daysBetween(today, upper), span = daysBetween(lower, upper);
      return {days, fullCycles: complete, partialDays: partial, partialCycleDays: span,
        amount: renewal.mul(complete).plus(renewal.mul(partial).div(span))};
    }
    upper = lower;
  }
  throw new Error('日期跨度超过可计算范围。');
}
export function calculateRemaining(input: RemainingValueInput): RemainingValueResult {
  const currency = input.currency?.toUpperCase(), target = input.targetCurrency?.toUpperCase();
  if (!supportedCurrencies.has(currency) || (target && !supportedCurrencies.has(target))) throw new Error('暂不支持该币种。');
  const local = new Date(), now = input.now || `${local.getFullYear()}-${String(local.getMonth()+1).padStart(2,'0')}-${String(local.getDate()).padStart(2,'0')}`;
  const estimate = remainingEstimate(input.amount, input.periodMonths, now, input.expiresAt);
  const result: RemainingValueResult = {value: formatMoney(estimate.amount, currency), currency,
    remainingDays: estimate.days, fullPeriods: estimate.fullCycles, partialDays: estimate.partialDays, periodDays: estimate.partialCycleDays,
    explanation: estimate.days ? `${estimate.fullCycles} 个完整续费周期 + ${estimate.partialDays}/${estimate.partialCycleDays} 个周期，按实际日历天数计算。` : '已到期，剩余价值为零。'};
  let reference = estimate.amount;
  if (target) {
    const rate = target === currency ? new Money(1) : exchangeValue(input.exchangeRate || '');
    if (!rate.isPositive()) throw new Error('汇率必须大于零。');
    reference = estimate.amount.mul(rate);
    result.convertedValue = formatMoney(reference, target); result.targetCurrency = target;
  }
  if (input.askingPrice?.trim()) result.premium = formatMoney(parseValue(input.askingPrice).minus(reference), target || currency);
  return result;
}
export interface RenewalHint {amount: string; currency: string; periodMonths: number}
export function extractRenewalHint(title: string): RenewalHint | undefined {
  const units: Record<string, number> = {month:1,mo:1,m:1,'月':1,'月付':1,quarter:3,'季':3,'季付':3,'半年付':6,year:12,yr:12,y:12,'年':12,'年付':12,'两年付':24,'三年付':36};
  const candidates: RenewalHint[] = [], cadence = '(?:/\\s*(month|quarter|year|mo|yr|m|y|月|季|年)(?![a-z])|(月付|季付|半年付|年付|两年付|三年付))';
  const prefix = new RegExp('(?<![a-z0-9])([a-z]{3}|US\\$|HK\\$)\\s*([0-9]{1,8}(?:\\.[0-9]{1,4})?)\\s*' + cadence, 'gi');
  const reverse = new RegExp('(?<![a-z0-9.])([0-9]{1,8}(?:\\.[0-9]{1,4})?)\\s*([a-z]{3}|美元|人民币|港币|刀)\\s*' + cadence, 'gi');
  for (const [regex, forward] of [[prefix,true],[reverse,false]] as const) for (const match of title.slice(0,4000).matchAll(regex)) {
    const raw = match[forward?1:2].toUpperCase(), currency = ({'US$':'USD','HK$':'HKD','美元':'USD','人民币':'CNY','港币':'HKD','刀':'USD'} as Record<string,string>)[raw] || raw;
    const periodMonths = units[(match[3] || match[4]).toLowerCase()];
    if (supportedCurrencies.has(currency) && periodMonths) candidates.push({amount:match[forward?2:1],currency,periodMonths});
  }
  return candidates.length && candidates.every(candidate => JSON.stringify(candidate) === JSON.stringify(candidates[0])) ? candidates[0] : undefined;
}
