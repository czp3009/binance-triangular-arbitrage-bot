import {OrderSide} from "binance-api-node";
import BigNumber from "bignumber.js";

export interface TradingChain {
    initAsset: string,
    firstAction: OrderSide,
    firstAsset: string,
    stepOneSymbol: string,
    secondAction: OrderSide,
    secondAsset: string,
    stepTwoSymbol: string,
    lastAction: OrderSide,
    stepThreeSymbol: string
}

export interface ValuableTradingChain extends TradingChain {
    initAssetQuantity: BigNumber,
    firstAssetQuantity: BigNumber,
    secondAssetQuantity: BigNumber,
    finalInitAssetQuantity: BigNumber,
    profit: BigNumber
}