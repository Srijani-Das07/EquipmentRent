/**
 * Money helpers. All stored amounts are integer paise (INR x 100) so there is never
 * floating-point drift. Config values are in rupees and converted here.
 */

export const rupeesToPaise = (rupees: number): number => Math.round(rupees * 100);

/** Percentage of an amount in paise, rounded to the nearest paisa. */
export const percentOf = (amountPaise: number, pct: number): number => Math.round((amountPaise * pct) / 100);

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
export const formatINR = (paise: number): string => inr.format(paise / 100);
