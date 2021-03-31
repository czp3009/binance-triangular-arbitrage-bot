import BigNumber from "bignumber.js";
import {Order, Ticker} from "binance-api-node";
import {TradingChain} from "./TradingChain";

export function toPair(asset: string, otherAsset: string, side: string) {
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

export function isExistLiquidity(ticker: Ticker, side: string) {
    return new BigNumber(side === "BUY" ? ticker.bestAsk : ticker.bestBid).gt(new BigNumber(0))
}

export function nextQuantity(ticker: Ticker, quantity: BigNumber, side: string) {
    return side === "BUY" ? quantity.dividedBy(new BigNumber(ticker.bestAsk)) : quantity.times(new BigNumber(ticker.bestBid))
}

//TODO min price movement https://www.binance.us/en/trade-limits
export function calculateBestInitQuantity(tickers: { [key: string]: Ticker }, tradingChain: TradingChain) {
    const {firstAction, stepOneSymbol, secondAction, stepTwoSymbol, lastAction, stepThreeSymbol} = tradingChain
    const [stepOneTicker, stepTwoTicker, stepThreeTicker] = [stepOneSymbol, stepTwoSymbol, stepThreeSymbol].map(it => tickers[it])

    function quantityPair(ticker: Ticker, side: string) {
        return side === "BUY" ? {
            left: new BigNumber(ticker.bestAskQnt).times(new BigNumber(ticker.bestAsk)),
            right: new BigNumber(ticker.bestAskQnt)
        } : {
            left: new BigNumber(ticker.bestBidQnt),
            right: new BigNumber(ticker.bestBidQnt).times(new BigNumber(ticker.bestBid))
        }
    }

    const [pair1, pair2, pair3] = [quantityPair(stepOneTicker, firstAction), quantityPair(stepTwoTicker, secondAction), quantityPair(stepThreeTicker, lastAction)]
    if (pair2.right.gt(pair3.left)) {
        const magnification = pair2.right.dividedBy(pair3.left)
        pair2.right = pair3.left
        pair2.left = pair2.left.dividedBy(magnification)
    }
    if (pair1.right.gt(pair2.left)) {
        const magnification = pair1.right.dividedBy(pair2.left)
        pair1.right = pair2.left
        pair1.left = pair1.left.dividedBy(magnification)
    }

    return pair1.left
}
