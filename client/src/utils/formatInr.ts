const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

/** Formats integer paise as rupees, e.g. 360000 -> "₹3,600". */
export function formatInr(paise: number): string {
  return INR.format(paise / 100);
}

const INR_EXACT = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Formats integer paise with the paise shown, e.g. 195050 -> "₹1,950.50". For expenses. */
export function formatInrExact(paise: number): string {
  return INR_EXACT.format(paise / 100);
}
