export function calculateSettlement(grossFen: number, commissionBps: number) {
  if (!Number.isInteger(grossFen) || grossFen <= 0) throw new Error('INVALID_GROSS_FEN');
  if (!Number.isInteger(commissionBps) || commissionBps < 1500 || commissionBps > 2500) {
    throw new Error('INVALID_COMMISSION_BPS');
  }
  const commissionFen = Math.floor(grossFen * commissionBps / 10_000);
  return { grossFen, commissionFen, providerFen: grossFen - commissionFen, commissionBps };
}
