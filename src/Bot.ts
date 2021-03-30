import Binance, {DailyStatsResult, OrderSide, Symbol} from "binance-api-node"
import BigNumber from "bignumber.js";
import {OrderSetting, TradingPairFilter} from "./Config";
import {ensureOrderFilled, formatToPercentage, getPair} from "./Utils";

export class Bot {
    private readonly client: import("binance-api-node").Binance
    private readonly quoteAssets: string[]
    private readonly tradingPairFilter: TradingPairFilter
    private readonly orderSetting: OrderSetting
    private initialized: boolean = false
    private candidateSymbols: Symbol[] = []
    private candidateTradingChains: TradingChain[] = []

    constructor(
        apiKey: string, apiSecret: string,
        quoteAssets: string[],
        tradingPairFilter: TradingPairFilter,
        orderSetting: OrderSetting,
        httpBase?: string
    ) {
        this.client = Binance({
            apiKey,
            apiSecret,
            httpBase
        })
        this.quoteAssets = quoteAssets
        this.tradingPairFilter = tradingPairFilter
        this.orderSetting = orderSetting
    }

    async init() {
        if (this.initialized) throw new Error("Already initialized")
        console.log("Init...")
        console.log("Checking network...")
        await this.client.ping()
        console.log("Checking permission...")
        if (!await this.client.accountInfo().then(it => it.canTrade)) {
            throw new Error("The currently used API key does not have permission to perform spot trade")
        }
        console.log("Chosen quote assets:")
        console.log(this.quoteAssets.join(", "))
        console.log("Analyze trading pairs...")
        this.candidateSymbols = await this.fetchTradingPairs()
        this.candidateTradingChains = await this.analyzeTradingPairs()
        if (this.candidateTradingChains.length === 0) {
            throw new Error("No candidate trading chain, please change settings and try again")
        }
        console.log(`Candidate trading chains: ${this.candidateTradingChains.length}`)
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

        return this.candidateTradingChains.filter(it =>
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
        }).filter(it => it.profit.isPositive())
    }

    async performOnce() {
        //check owned assets
        console.log("Fetching assets...")
        const availableAssets = await this.fetchAssets()
        if (availableAssets.length === 0) {
            console.log("No available assets in your account")
            return
        }
        console.log("Owned assets:")
        console.log(availableAssets.map(it => `${it.quantity} ${it.asset}`).join(", "))
        const chosenQuoteAssets = availableAssets.map(it => it.asset).filter(it => this.quoteAssets.includes(it))
        if (chosenQuoteAssets.length === 0) {
            console.log("No quote asset chosen")
            return
        }
        //check trading chains
        const lucrativeTradingChains = await this.findOutLucrativeTradingChains()
        if (lucrativeTradingChains.length === 0) {
            console.log("No lucrative trading chains")
            return
        }
        console.log(`Lucrative trading chains: ${lucrativeTradingChains.length}`)
        //TODO check lot size
        const chosenTradingChains = lucrativeTradingChains.filter(it => chosenQuoteAssets.includes(it.initAsset))
            .sort((a, b) => b.profit.minus(a.profit).toNumber())
        if (chosenTradingChains.length === 0) {
            console.log("No available trading chain")
            return
        }
        console.log("Chosen trading chain(show top 5):")
        chosenTradingChains.slice(0, 5).forEach(it => {
            console.log(`${it.initAssetQuantity} ${it.initAsset} -> ${it.firstAssetQuantity} ${it.firstAsset} -> ${it.secondAssetQuantity} ${it.secondAsset} -> ${it.finalInitAssetQuantity} ${it.initAsset} profit: ${formatToPercentage(it.profit)}`)
        })
        const selectedTradingChain = chosenTradingChains[0]
        if (selectedTradingChain.profit.lte(new BigNumber(this.orderSetting.onlyProfitGreaterEqualThan))) {
            console.log(`No trading chain profit exceed than ${formatToPercentage(this.orderSetting.onlyProfitGreaterEqualThan)}`)
            return
        }
        const {initAsset, firstAction, firstAsset, secondAction, secondAsset, lastAction, profit} = selectedTradingChain
        console.log(`Selected trading chain: ${initAsset} -> ${firstAsset} -> ${secondAsset} -> ${initAsset}, expect profit ${formatToPercentage(profit)}`)
        //start trade
        if (!this.orderSetting.enable) {
            console.log("Trading not enabled")
            return
        }
        console.log("Start trade")
        //step 1
        console.log(`Step 1(${initAsset} -> ${firstAsset}):`)
        const stepOneSymbol = getPair(initAsset, firstAsset, firstAction)
        //TODO change quantity to fit size movement limit
        const stepOneQuantity = availableAssets.find(it => it.asset === initAsset)!.quantity.times(new BigNumber(this.orderSetting.investmentRatio))
        console.log(`Init quantity: ${stepOneQuantity}`)
        const stepOneOrder = await this.client.order({
            symbol: stepOneSymbol,
            side: firstAction,
            quantity: stepOneQuantity.toString(),
            type: "MARKET"
        })
        ensureOrderFilled(stepOneOrder)
        const stepTwoQuantity = new BigNumber(stepOneOrder.cummulativeQuoteQty)
        console.log(`${stepOneQuantity} ${initAsset} -> ${stepTwoQuantity} ${firstAsset}`)
        //step 2
        console.log(`Step 2(${firstAsset} -> ${secondAsset})`)
        const stepTwoSymbol = getPair(firstAsset, secondAsset, secondAction)
        const stepTwoOrder = await this.client.order({
            symbol: stepTwoSymbol,
            side: secondAction,
            quantity: stepTwoQuantity.toString(),
            type: "MARKET"
        })
        ensureOrderFilled(stepTwoOrder)
        const stepThreeQuantity = new BigNumber(stepTwoOrder.cummulativeQuoteQty)
        console.log(`${stepTwoQuantity} ${firstAsset} -> ${stepThreeQuantity} ${secondAsset}`)
        //step 3
        console.log(`Step 2(${secondAsset} -> ${initAsset})`)
        const stepThreeSymbol = getPair(secondAsset, initAsset, lastAction)
        const stepThreeOrder = await this.client.order({
            symbol: stepThreeSymbol,
            side: lastAction,
            quantity: stepThreeQuantity.toString(),
            type: "MARKET"
        })
        ensureOrderFilled(stepThreeOrder)
        const finalQuantity = new BigNumber(stepThreeOrder.cummulativeQuoteQty)
        console.log(`${stepThreeQuantity} ${secondAsset} -> ${finalQuantity} ${initAsset}`)
        //summary
        console.log(`Summary: ${initAsset} ${stepOneQuantity} -> ${finalQuantity}`)
        const actualProfit = finalQuantity.minus(stepOneQuantity).dividedBy(stepOneQuantity)
        console.log(`Actual profit: ${formatToPercentage(actualProfit)}`)
    }

    private async fetchAssets() {
        const accountInfo = await this.client.accountInfo()
        return accountInfo.balances.map(it => ({
            asset: it.asset,
            quantity: new BigNumber(it.free)
        })).filter(it => it.quantity.gt(new BigNumber(0)))
    }

    private async fetchTradingPairs() {
        const client = this.client
        const exchangeInfo = await client.exchangeInfo()
        let symbols = exchangeInfo.symbols.filter(it => it.status === "TRADING" && it.isSpotTradingAllowed && it.orderTypes.includes("MARKET"))
        if (this.tradingPairFilter.enable) {
            const {blackList, quoteVolumeLimit, volumeLimit, tradeCountLimit} = this.tradingPairFilter
            if (blackList.length !== 0) {
                symbols = symbols.filter(it => !blackList.includes(it.symbol))
            }
            let cachedDailyStats: DailyStatsResult[]

            async function getDailyStats() {
                if (cachedDailyStats == null) {
                    cachedDailyStats = await client.dailyStats() as DailyStatsResult[]
                }
                return cachedDailyStats
            }

            if (quoteVolumeLimit !== 0 || volumeLimit !== 0) {
                const dailyStats = await getDailyStats()
                symbols = symbols.filter(symbol => {
                    const dailyStat = dailyStats.find(it => it.symbol === symbol.symbol)
                    if (dailyStat == null) return false
                    return new BigNumber(dailyStat.quoteVolume).gte(quoteVolumeLimit) && new BigNumber(dailyStat.volume).gte(volumeLimit)
                })
            }
            if (tradeCountLimit !== 0) {
                const dailyStats = await getDailyStats()
                symbols = symbols.filter(symbol => {
                    const dailyStat = dailyStats.find(it => it.symbol === symbol.symbol)
                    if (dailyStat == null) return false
                    return new BigNumber(dailyStat.count).gte(tradeCountLimit)
                })
            }
        }
        return symbols
    }

    private async analyzeTradingPairs() {
        const symbols = this.candidateSymbols

        function analyzeNextStep(asset: string): { asset: string, side: OrderSide }[] {
            return symbols.filter(it => it.baseAsset === asset || it.quoteAsset === asset)
                .map(it => ({
                    asset: it.baseAsset === asset ? it.quoteAsset : it.baseAsset,
                    side: it.baseAsset === asset ? "SELL" : "BUY"
                }))
        }

        const tradingChain = this.quoteAssets.map(initAsset => ({
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
        const candidateTradingChains: TradingChain[] = []
        tradingChain.forEach(init => {
            init.availablePairs.forEach(first => {
                first.availablePairs.forEach(second => {
                    second.availablePairs.forEach(third => {
                        if (third.asset === init.asset) {
                            candidateTradingChains.push({
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
        return candidateTradingChains
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
