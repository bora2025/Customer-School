/**
 * Formats a minor-unit amount (e.g. cents) as a currency string, using each
 * currency's actual minor-unit exponent from `Intl.NumberFormat` rather than
 * assuming 2 decimal places for everything. This is what actually distinguishes
 * a currency like JPY (0 decimals) from USD (2) -- there is no need to hardcode
 * a currency list, `Intl` already carries the correct table.
 */
export function formatMoney(amountMinor: number, currency: string, locale = 'en-US'): string {
  const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency });
  const minorUnitDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  const amount = amountMinor / 10 ** minorUnitDigits;
  return formatter.format(amount);
}

/**
 * Formats an amount already in major units (e.g. school fee/budget figures, stored as plain
 * decimal dollars rather than minor-unit integers like the marketplace's cents) -- still with
 * each currency's real decimal-place and symbol rules from `Intl`, not a hardcoded `$`+2-decimals.
 */
export function formatMoneyMajor(amountMajor: number, currency: string, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amountMajor);
}
