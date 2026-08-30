
export const formatCost = (value: unknown, symbol: string, decimals = 2) => {
  const num = Number(value);
  const formatted = Number.isFinite(num)
    ? num.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : '0.00';
  return symbol === '€' ? `${formatted} ${symbol}` : `${symbol}${formatted}`;
};

export const CURRENCIES = ['EUR (€)', 'USD ($)', 'GBP (£)', 'JPY (¥)', 'CHF (₣)'];
export const DECIMAL_SYMBOLS = [',', '.'];
export const DATE_FORMATS = [
  { value: 'locale', labelKey: 'settings.language.date_format_locale' },
  { value: 'DD/MM/YYYY', labelKey: 'settings.language.date_format_dmy' },
  { value: 'MM/DD/YYYY', labelKey: 'settings.language.date_format_mdy' },
  { value: 'YYYY-MM-DD', labelKey: 'settings.language.date_format_iso' },
];
