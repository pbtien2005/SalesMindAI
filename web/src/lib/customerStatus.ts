import type { CustomerStatus } from '../api/types';

/** Thứ tự hiển thị = thứ tự đi của một khách. "Chưa tư vấn" khác chip "Mới" ở hộp thư (khách nhắn mà Page chưa trả lời). */
export const CUSTOMER_STATUS_ORDER: readonly CustomerStatus[] = ['new', 'consulting', 'quoted', 'won', 'lost'];

export const CUSTOMER_STATUS_LABEL: Record<CustomerStatus, string> = {
  new: 'Chưa tư vấn',
  consulting: 'Đang tư vấn',
  quoted: 'Đã báo giá',
  won: 'Đã chốt',
  lost: 'Không mua',
};
