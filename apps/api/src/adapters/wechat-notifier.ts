export interface WechatNotificationClient {
  sendTemplate(message: {
    recipientOpenId: string;
    template: 'ORDER_STATUS';
    data: { orderId: string; statusLabel: string };
  }): Promise<void>;
}

export class WechatNotifier {
  public constructor(private readonly client: WechatNotificationClient) {}
  public orderStatus(recipientOpenId: string, data: { orderId: string; statusLabel: string }) {
    return this.client.sendTemplate({ recipientOpenId, template: 'ORDER_STATUS', data });
  }
}
