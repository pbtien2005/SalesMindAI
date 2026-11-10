/** Nhãn tiếng Việt cho trường hồ sơ và nguồn tin. */

export const FIELD_LABELS: Record<string, string> = {
  customer_name: 'Tên',
  product_interest: 'Sản phẩm quan tâm',
  budget: 'Ngân sách',
  quantity: 'Số lượng',
  phone: 'Số điện thoại',
  timeline: 'Ngày hẹn xem hàng',
  address: 'Địa chỉ',
};

/** Thứ tự hiện trên thẻ khách. */
export const CARD_FIELDS = ['customer_name', 'product_interest', 'budget', 'quantity', 'phone', 'timeline', 'address'] as const;

export const fieldLabel = (field: string): string => FIELD_LABELS[field] ?? field;

/** Nhãn nguồn của tin do Page gửi. Tin của khách không có nhãn. */
export function senderLabel(kind: string): string {
  switch (kind) {
    case 'page_inbox':
      return 'Page Inbox';
    case 'page_app':
      return 'SalesMind';
    case 'page_other':
      return 'Ứng dụng khác';
    case 'page_unknown':
      return 'Page';
    default:
      return '';
  }
}

/** Chữ cái đầu của tên cuối ("Chị Thu" -> "T", "Facebook: anh Minh" -> "M"). */
export function initial(name: string): string {
  const last = name.trim().split(/\s+/).at(-1) ?? '';
  return (last[0] ?? '?').toLocaleUpperCase('vi');
}
