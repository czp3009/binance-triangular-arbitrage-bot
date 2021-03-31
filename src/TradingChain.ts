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
    minInitAsset: BigNumber,
    stepOneLeftQuantity: BigNumber,
    stepOneAvailableLeftDecimalPlaces: number
    stepOneRightQuantity: BigNumber,
    firstAssetRemain: BigNumber,
    stepTwoLeftQuantity: BigNumber,
    stepTwoAvailableLeftDecimalPlaces: number,
    stepTwoRightQuantity: BigNumber,
    secondAssetRemain: BigNumber,
    stepThreeLeftQuantity: BigNumber,
    stepThreeAvailableLeftDecimalPlaces: number,
    stepThreeRightQuantity: BigNumber,
    profit: BigNumber
}
