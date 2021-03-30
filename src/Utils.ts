import BigNumber from "bignumber.js";
import {Order} from "binance-api-node";

export function getPair(asset: string, otherAsset: string, side: string) {
    return side === "BUY" ? `${otherAsset}${asset}` : `${asset}${otherAsset}`
}

export function formatToPercentage(n: number | BigNumber) {
    return `${new BigNumber(n).times(new BigNumber(100))}%`
}

export function ensureOrderFilled(order: Order) {
    if (order.status != "FILLED") {
        throw new Error(`Illegal order status: ${order.status}\n${JSON.stringify(order)}`)
    }
}
