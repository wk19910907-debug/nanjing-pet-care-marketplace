export function definePilotMetrics(window: { from: string; to: string; timezone: string }) {
  const shared = { timezone: window.timezone, window: `${window.from}—${window.to}` };
  return [
    { key: 'median_first_accept_seconds', numerator: '各已接单订单首次接受耗时秒数的中位数', denominator: '窗口内已接单订单', ...shared },
    { key: 'dispatch_success_rate', numerator: '成功匹配订单数', denominator: '支付后进入派单订单数', ...shared },
    { key: 'completion_rate', numerator: '已完成订单数', denominator: '已接单且服务时间已到订单数', ...shared },
    { key: 'on_time_rate', numerator: '开始前后15分钟签到订单数', denominator: '已签到订单数', ...shared },
    { key: 'complaint_rate', numerator: '产生投诉订单数', denominator: '已提交报告订单数', ...shared },
    { key: 'refund_rate', numerator: '产生退款订单数', denominator: '支付成功订单数', ...shared },
    { key: 'repeat_owner_rate', numerator: '窗口内完成两单及以上宠主数', denominator: '窗口内完成订单宠主数', ...shared },
    { key: 'support_minutes_per_order', numerator: '客服处理分钟总数', denominator: '客服处理订单数', ...shared },
    { key: 'platform_gross_fen', numerator: '已确认结算平台佣金分之和', denominator: '窗口内已确认结算', ...shared },
    { key: 'provider_payout_fen', numerator: '服务者应得金额分之和', denominator: '窗口内已确认结算', ...shared },
  ];
}
