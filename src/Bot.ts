import Binance, {DailyStatsResult, OrderSide} from "binance-api-node"
import BigNumber from "bignumber.js";
import {TradingPairFilter} from "./Config";
import {getPair} from "./Utils";

export class Bot {
    private readonly client: import("binance-api-node").Binance
    private readonly quoteAssets: string[]
    private readonly tradingPairFilter: TradingPairFilter
    private readonly investmentRatio: BigNumber
    private readonly onlyProfitGreaterEqualThan: BigNumber
    private initialized: boolean = false
    private chosenQuoteAssets: { asset: string, quantity: BigNumber }[] = []
    private availableTradingChains: TradingChain[] = []

    constructor(
        apiKey: string, apiSecret: string,
        quoteAssets: string[],
        tradingPairFilter: TradingPairFilter,
        investmentRatio: BigNumber,
        onlyProfitGreaterEqualThan: BigNumber,
        httpBase?: string
    ) {
        this.client = Binance({
            apiKey,
            apiSecret,
            httpBase
        })
        this.quoteAssets = quoteAssets
        this.tradingPairFilter = tradingPairFilter
        this.investmentRatio = investmentRatio
        this.onlyProfitGreaterEqualThan = onlyProfitGreaterEqualThan
    }

    async init() {
        if (this.initialized) throw new Error("Already initialized")
        console.log("Init...")
        console.log("Loading assets...")
        const freeAssets = await this.fetchAssets()
        if (freeAssets.length === 0) throw new Error("No available asset in your account")
        console.log("Free assets:")
        freeAssets.forEach(it => {
            console.log(`${it.asset}: ${it.quantity}`)
        })
        this.chosenQuoteAssets = freeAssets.filter(it => this.quoteAssets.includes(it.asset)).map(it => ({
            asset: it.asset,
            quantity: it.quantity
        }))
        if (this.chosenQuoteAssets.length === 0) throw new Error("No quote asset is available")
        console.log("Chosen quote assets:")
        console.log(this.chosenQuoteAssets.map(it => it.asset).join(", "))
        console.log("Analyze trading pairs...")
        this.availableTradingChains = await this.analyzeTradingPairs()
        if (this.availableTradingChains.length === 0) throw new Error("No available trading chain")
        console.log("Available trading chain:")
        this.availableTradingChains.forEach(it => {
            console.log(`${it.initAsset} -> ${it.firstAsset} -> ${it.secondAsset} -> ${it.initAsset}`)
        })
    }

    async findOutLucrativeTradingChains(): Promise<ValuableTradingChain[]> {
        //some price will be 0 on testnet
        const prices = await this.client.prices()
        const invalidPairs = Object.keys(prices).filter(it => new BigNumber(prices[it]).eq(new BigNumber(0)))

        function getPrice(asset: string, otherAsset: string, side: string) {
            return new BigNumber(prices[getPair(asset, otherAsset, side)])
        }

        function nextQuantity(asset: string, quantity: BigNumber, nextAsset: string, side: string) {
            const price = getPrice(asset, nextAsset, side)
            return side === "BUY" ? quantity.dividedBy(price) : quantity.times(price)
        }

        return this.availableTradingChains.filter(it =>
            !invalidPairs.includes(getPair(it.initAsset, it.firstAsset, it.firstAction)) &&
            !invalidPairs.includes(getPair(it.firstAsset, it.secondAsset, it.secondAction)) &&
            !invalidPairs.includes(getPair(it.secondAsset, it.initAsset, it.lastAction))
        ).map(it => {
            const initAssetQuantity = new BigNumber(1)
            const firstAssetQuantity = nextQuantity(it.initAsset, initAssetQuantity, it.firstAsset, it.firstAction)
            const secondAssetQuantity = nextQuantity(it.firstAsset, firstAssetQuantity, it.secondAsset, it.secondAction)
            const finalInitAssetQuantity = nextQuantity(it.secondAsset, secondAssetQuantity, it.initAsset, it.lastAction)
            const profit = finalInitAssetQuantity.minus(initAssetQuantity).dividedBy(initAssetQuantity)
            return {...it, initAssetQuantity, firstAssetQuantity, secondAssetQuantity, finalInitAssetQuantity, profit}
        }).sort((a, b) => b.profit.minus(a.profit).toNumber())
    }

    async performOnce() {
        const lucrativeTradingChains = await this.findOutLucrativeTradingChains()
        if (lucrativeTradingChains.length === 0) {
            console.log("No lucrative trading chains")
            return
        }
        lucrativeTradingChains.slice(0, 5).forEach(it => {
            console.log(`${it.initAssetQuantity} ${it.initAsset} -> ${it.firstAssetQuantity} ${it.firstAsset} -> ${it.secondAssetQuantity} ${it.secondAsset} -> ${it.finalInitAssetQuantity} ${it.initAsset} profit: ${it.profit.times(new BigNumber(100))}%`)
        })
        const lucrativeTradingChain = lucrativeTradingChains[0]
        const {initAsset, firstAction, firstAsset, secondAction, secondAsset, lastAction} = lucrativeTradingChain
        console.log(`Selected trading chain: ${initAsset} -> ${firstAsset} -> ${secondAsset} -> ${initAsset}`)
        //send order
        //first
        const firstOrder = await this.client.order({
            symbol: getPair(initAsset, firstAsset, firstAction),
            side: firstAction,
            quantity: this.chosenQuoteAssets.find(it => it.asset === initAsset)!.quantity.toString(),
            type: "MARKET"
        })
        //second
        const secondOrder = await this.client.order({
            symbol: getPair(firstAsset, secondAsset, secondAction),
            side: secondAction,
            quantity: firstOrder.cummulativeQuoteQty,
            type: "MARKET"
        })
        //third
        const thirdOrder = await this.client.order({
            symbol: getPair(secondAsset, initAsset, lastAction),
            side: lastAction,
            quantity: secondOrder.cummulativeQuoteQty,
            type: "MARKET"
        })
    }

    private async fetchAssets() {
        const accountInfo = await this.client.accountInfo()
        if (!accountInfo.canTrade) {
            throw new Error("The currently used API key does not have permission to perform spot trade")
        }
        return accountInfo.balances.map(it => ({
            asset: it.asset,
            quantity: new BigNumber(it.free)
        })).filter(it => it.quantity.gt(new BigNumber(0)))
    }

    private async analyzeTradingPairs() {
        let symbols = (await this.client.exchangeInfo()).symbols.filter(it => it.status === "TRADING" && it.isSpotTradingAllowed && it.orderTypes.includes("MARKET"))
        if (this.tradingPairFilter.enable) {
            const {blackList, quoteVolumeLimit, volumeLimit, tradeSpeedLimit} = this.tradingPairFilter
            if (blackList.length !== 0) {
                symbols = symbols.filter(it => !blackList.includes(it.symbol))
            }
            if (quoteVolumeLimit !== 0 || volumeLimit !== 0) {
                const dailyStats = (await this.client.dailyStats()) as DailyStatsResult[]
                symbols = symbols.filter(symbol => {
                    const dailyStat = dailyStats.find(it => it.symbol === symbol.symbol)
                    if (dailyStat == null) return false
                    return new BigNumber(dailyStat.quoteVolume).gte(quoteVolumeLimit) && new BigNumber(dailyStat.volume).gte(volumeLimit)
                })
            }
            if (tradeSpeedLimit !== 0) {
                const tradeSpeedLimitBigNumber = new BigNumber(tradeSpeedLimit)
                const boolArray = await Promise.all(symbols.map(async symbol => {
                    const trades = await this.client.trades({symbol: symbol.symbol, limit: 100})
                    if (trades.length <= 1) return false
                    const period = new BigNumber(trades[trades.length - 1].time).minus(new BigNumber(trades[0].time)).dividedBy(new BigNumber(100))
                    const transactionAmount = new BigNumber(trades.length)
                    const tradeSpeed = transactionAmount.dividedBy(period)
                    return tradeSpeed.gte(tradeSpeedLimitBigNumber)
                }))
                symbols = symbols.filter((_, i) => boolArray[i])
            }
        }

        function analyzeNextStep(asset: string): { asset: string, side: OrderSide }[] {
            return symbols.filter(it => it.baseAsset === asset || it.quoteAsset === asset)
                .map(it => ({
                    asset: it.baseAsset === asset ? it.quoteAsset : it.baseAsset,
                    side: it.baseAsset === asset ? "SELL" : "BUY"
                }))
        }

        const tradingChain = this.chosenQuoteAssets.map(it => it.asset).map(initAsset => ({
            asset: initAsset,
            availablePairs: analyzeNextStep(initAsset).map(secondAsset => ({
                asset: secondAsset.asset,
                side: secondAsset.side,
                availablePairs: analyzeNextStep(secondAsset.asset).filter(it => it.asset != initAsset).map(thirdAsset => ({
                    asset: thirdAsset.asset,
                    side: thirdAsset.side,
                    availablePairs: analyzeNextStep(thirdAsset.asset).filter(it => it.asset != secondAsset.asset)
                }))
            }))
        }))
        const availableTradingChains: TradingChain[] = []
        tradingChain.forEach(init => {
            init.availablePairs.forEach(first => {
                first.availablePairs.forEach(second => {
                    second.availablePairs.forEach(third => {
                        if (third.asset === init.asset) {
                            availableTradingChains.push({
                                initAsset: init.asset,
                                firstAction: first.side,
                                firstAsset: first.asset,
                                secondAction: second.side,
                                secondAsset: second.asset,
                                lastAction: third.side
                            })
                        }
                    })
                })
            })
        })
        return availableTradingChains
    }
}

interface TradingChain {
    initAsset: string,
    firstAction: OrderSide,
    firstAsset: string,
    secondAction: OrderSide,
    secondAsset: string,
    lastAction: OrderSide
}

interface ValuableTradingChain extends TradingChain {
    initAssetQuantity: BigNumber,
    firstAssetQuantity: BigNumber,
    secondAssetQuantity: BigNumber,
    finalInitAssetQuantity: BigNumber,
    profit: BigNumber
}
