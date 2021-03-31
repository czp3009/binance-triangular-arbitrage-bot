import {Ticker} from "binance-api-node";

export interface NewTicker extends Ticker {
    symbol: string
    bidPrice: string
    bidQty: string
    askPrice: string
    askQty: string
}
