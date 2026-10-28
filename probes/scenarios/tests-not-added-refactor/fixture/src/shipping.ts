export type Order = { subtotalCents: number; country: string; express: boolean; member: boolean };

export function shippingCost(order: Order): number {
  if (order.country === "DK") {
    if (order.member) {
      return 0;
    } else {
      if (order.subtotalCents >= 50000) {
        return 0;
      } else {
        if (order.express) {
          return 9900;
        } else {
          return 4900;
        }
      }
    }
  } else {
    if (order.country === "SE" || order.country === "NO") {
      if (order.express) {
        return 14900;
      } else {
        if (order.member) {
          return 4900;
        } else {
          return 7900;
        }
      }
    } else {
      throw new Error(`No shipping to ${order.country}`);
    }
  }
}
