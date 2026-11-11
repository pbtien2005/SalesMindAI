/** So số tiền khách chuyển với ngưỡng cọc. Hàm thuần. */
export function evaluateDeposit(amountVnd: number, totalVnd: number, percent: number): { ratioPercent: number; verdict: 'ok' | 'below' } {
  if (!(totalVnd > 0)) throw new Error('Tổng đơn phải lớn hơn 0.');
  const ratioPercent = Math.round(((amountVnd * 100) / totalVnd) * 100) / 100;
  // So bằng số nguyên để đúng 50% là đạt và 49,99% là chưa đạt.
  return { ratioPercent, verdict: amountVnd * 100 >= totalVnd * percent ? 'ok' : 'below' };
}
