import Binance, {DailyStatsResult, OrderSide, Symbol, SymbolLotSizeFilter, SymbolPriceFilter} from "binance-api-node"
import BigNumber from "bignumber.js";
import {OrderSetting, TradingPairFilter} from "./Config";
import {ensureOrderFilled, formatToPercentage, toPair} from "./Utils";
import {TradingChain, ValuableTradingChain} from "./TradingChain";
import {NewTicker} from "./Bug";

export class Bot {
    private readonly client: import("binance-api-node").Binance
    private readonly quoteAssets: string[]
    private readonly tradingPairFilter: TradingPairFilter
    private readonly orderSetting: OrderSetting
    private initialized: boolean = false
    private candidateSymbols: Symbol[] = []
    private candidateSymbolMap = new Map<string, Symbol>()
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
        this.candidateSymbols.forEach(it => {
            this.candidateSymbolMap.set(it.symbol, it)
        })
        this.candidateTradingChains = await this.analyzeTradingPairs()
        if (this.candidateTradingChains.length === 0) {
            throw new Error("No candidate trading chain, please change settings and try again")
        }
        console.log(`Candidate trading chains: ${this.candidateTradingChains.length}`)
    }

    async performOnce() {
        //check owned assets
        console.log("Fetching assets...")
        const availableAssetMap = await this.fetchAssets()
        if (availableAssetMap.size === 0) {
            console.log("No available assets in your account")
            return
        }

        //chose quote assets
        const availableAssetToQuantity = Array.from(availableAssetMap)
        console.log("Owned assets:")
        console.log(availableAssetToQuantity.map(([asset, quantity]) => `${quantity} ${asset}`).join(", "))
        const chosenQuoteAssetMap = new Map<string, BigNumber>()
        availableAssetToQuantity.forEach(([asset, quantity]) => {
            if (this.quoteAssets.includes(asset)) chosenQuoteAssetMap.set(asset, quantity)
        })
        if (chosenQuoteAssetMap.size === 0) {
            console.log("No quote asset chosen")
            return
        }
        console.log("Chosen assets:")
        console.log(Array.from(chosenQuoteAssetMap.keys()).join(", "))

        //check trading chains
        const lucrativeTradingChains = (await this.findOutLucrativeTradingChains(chosenQuoteAssetMap))
            .filter(it => chosenQuoteAssetMap.get(it.initAsset)!.gte(it.minInitAsset))
            .sort((a, b) => b.profit.minus(a.profit).toNumber())
        if (lucrativeTradingChains.length === 0) {
            console.log("No lucrative trading chains")
            return
        }
        console.log("Chosen trading chain(show top 5):")
        lucrativeTradingChains.slice(0, 5).forEach(it => {
            console.log(`${it.stepOneLeftQuantity} ${it.initAsset} -> ${it.stepTwoLeftQuantity} ${it.firstAsset} -> ${it.stepThreeLeftQuantity} ${it.secondAsset} -> ${it.stepThreeRightQuantity} ${it.initAsset} profit: ${formatToPercentage(it.profit)}`)
        })
        const selectedTradingChain = lucrativeTradingChains[0]
        if (selectedTradingChain.profit.lte(new BigNumber(this.orderSetting.onlyProfitGreaterEqualThan))) {
            console.log(`No trading chain profit exceed than ${formatToPercentage(this.orderSetting.onlyProfitGreaterEqualThan)}`)
            return
        }
        const {
            initAsset, firstAction, firstAsset, secondAction, secondAsset, lastAction,
            profit,
            stepOneSymbol, stepTwoSymbol, stepThreeSymbol,
            stepOneAvailableLeftDecimalPlaces, stepTwoAvailableLeftDecimalPlaces, stepThreeAvailableLeftDecimalPlaces
        } = selectedTradingChain
        console.log(`Selected trading chain: ${initAsset} -> ${firstAsset} -> ${secondAsset} -> ${initAsset}, expect profit ${formatToPercentage(profit)}`)

        //start trade
        if (!this.orderSetting.enable) {
            console.log("Trading not enabled")
            return
        }
        let chosenInitAssetQuantity = chosenQuoteAssetMap.get(initAsset)!.times(this.orderSetting.maxInvestmentRatio)
        if (this.orderSetting.useBestInitQuantity) {
            chosenInitAssetQuantity = BigNumber.min(chosenInitAssetQuantity, selectedTradingChain.stepOneLeftQuantity)
        }
        chosenInitAssetQuantity = chosenInitAssetQuantity.decimalPlaces(stepOneAvailableLeftDecimalPlaces, 1)
        if (chosenInitAssetQuantity.lt(selectedTradingChain.minInitAsset)) {
            console.log(`Only ${chosenInitAssetQuantity} ${initAsset} can be used, not meet min price limit ${selectedTradingChain.minInitAsset}`)
        }
        console.log("Start trade")
        console.log(`Chosen init asset quantity: ${chosenInitAssetQuantity}`)
        //step 1
        console.log(`Step 1(${initAsset} -> ${firstAsset}):`)
        const stepOneOrder = await this.client.order({
            symbol: stepOneSymbol,
            side: firstAction,
            quantity: chosenInitAssetQuantity.toString(),
            type: "MARKET"
        })
        ensureOrderFilled(stepOneOrder)
        const actualStepTwoLeftQuantity = new BigNumber(stepOneOrder.cummulativeQuoteQty).decimalPlaces(stepTwoAvailableLeftDecimalPlaces, 1)
        console.log(`${chosenInitAssetQuantity} ${initAsset} -> ${actualStepTwoLeftQuantity} ${firstAsset}`)
        //step 2
        console.log(`Step 2(${firstAsset} -> ${secondAsset})`)
        const stepTwoOrder = await this.client.order({
            symbol: stepTwoSymbol,
            side: secondAction,
            quantity: actualStepTwoLeftQuantity.toString(),
            type: "MARKET"
        })
        ensureOrderFilled(stepTwoOrder)
        const actualStepThreeLeftQuantity = new BigNumber(stepTwoOrder.cummulativeQuoteQty).decimalPlaces(stepThreeAvailableLeftDecimalPlaces, 1)
        console.log(`${actualStepTwoLeftQuantity} ${firstAsset} -> ${actualStepThreeLeftQuantity} ${secondAsset}`)
        //step 3
        console.log(`Step 2(${secondAsset} -> ${initAsset})`)
        const stepThreeOrder = await this.client.order({
            symbol: stepThreeSymbol,
            side: lastAction,
            quantity: actualStepThreeLeftQuantity.toString(),
            type: "MARKET"
        })
        ensureOrderFilled(stepThreeOrder)
        const actualFinalQuantity = new BigNumber(stepThreeOrder.cummulativeQuoteQty)
        console.log(`${actualStepThreeLeftQuantity} ${secondAsset} -> ${actualFinalQuantity} ${initAsset}`)
        //summary
        console.log(`Summary: ${initAsset} ${chosenInitAssetQuantity} -> ${actualFinalQuantity}`)
        const actualProfit = actualFinalQuantity.minus(chosenInitAssetQuantity).dividedBy(chosenInitAssetQuantity)
        console.log(`Actual profit: ${formatToPercentage(actualProfit)}`)
    }

    private async fetchAssets() {
        const accountInfo = await this.client.accountInfo()
        const assetMap = new Map<string, BigNumber>()
        accountInfo.balances.forEach(it => {
            const quantity = new BigNumber(it.free)
            if (quantity.gt(0)) {
                assetMap.set(it.asset, quantity)
            }
        })
        return assetMap
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

            let dailyStatMap: Map<string, DailyStatsResult> | null = null

            async function getDailyStatMap() {
                if (dailyStatMap == null) {
                    dailyStatMap = new Map<string, DailyStatsResult>()
                    const dailyStats = await client.dailyStats() as DailyStatsResult[]
                    dailyStats.forEach(it => {
                        dailyStatMap!.set(it.symbol, it)
                    })
                }
                return dailyStatMap
            }

            if (quoteVolumeLimit !== 0 || volumeLimit !== 0) {
                const dailyStats = await getDailyStatMap()
                symbols = symbols.filter(symbol => {
                    const dailyStat = dailyStats.get(symbol.symbol)
                    if (dailyStat == null) return false
                    return new BigNumber(dailyStat.quoteVolume).gte(quoteVolumeLimit) && new BigNumber(dailyStat.volume).gte(volumeLimit)
                })
            }
            if (tradeCountLimit !== 0) {
                const dailyStats = await getDailyStatMap()
                symbols = symbols.filter(symbol => {
                    const dailyStat = dailyStats.get(symbol.symbol)
                    if (dailyStat == null) return false
                    return new BigNumber(dailyStat.count).gte(tradeCountLimit)
                })
            }
        }
        return symbols
    }

    private async analyzeTradingPairs() {
        const candidateSymbols = this.candidateSymbols

        function findNextSteps(asset: string): { asset: string, side: OrderSide }[] {
            return candidateSymbols.filter(it => it.baseAsset === asset || it.quoteAsset === asset)
                .map(it => ({
                    asset: it.baseAsset === asset ? it.quoteAsset : it.baseAsset,
                    side: it.baseAsset === asset ? "SELL" : "BUY"
                }))
        }

        const tradingChain = this.quoteAssets.map(initAsset => ({
            asset: initAsset,
            availablePairs: findNextSteps(initAsset).map(secondAsset => ({
                asset: secondAsset.asset,
                side: secondAsset.side,
                availablePairs: findNextSteps(secondAsset.asset).filter(it => it.asset != initAsset).map(thirdAsset => ({
                    asset: thirdAsset.asset,
                    side: thirdAsset.side,
                    availablePairs: findNextSteps(thirdAsset.asset).filter(it => it.asset != secondAsset.asset)
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
                                stepOneSymbol: toPair(init.asset, first.asset, first.side),
                                secondAction: second.side,
                                secondAsset: second.asset,
                                stepTwoSymbol: toPair(first.asset, second.asset, second.side),
                                lastAction: third.side,
                                stepThreeSymbol: toPair(second.asset, init.asset, third.side)
                            })
                        }
                    })
                })
            })
        })
        return candidateTradingChains
    }

    private async findOutLucrativeTradingChains(chosenQuoteAssetMap: Map<string, BigNumber>): Promise<ValuableTradingChain[]> {
        const allBookTickers = (await this.client.allBookTickers()) as { [key: string]: NewTicker }
        const symbolMap = this.candidateSymbolMap

        function existLiquidity(symbol: string, side: string) {
            const ticker = allBookTickers[symbol]
            return new BigNumber(side === "BUY" ? ticker.askPrice : ticker.bidPrice).gt(0)
        }

        function quantityPair(ticker: NewTicker, side: string) {
            const symbol = ticker.symbol
            const filters = symbolMap.get(symbol)!.filters
            const priceFilter = filters.find(it => it.filterType === "PRICE_FILTER") as SymbolPriceFilter
            const lotSizeFilter = filters.find(it => it.filterType === "LOT_SIZE") as SymbolLotSizeFilter
            if (side === "BUY") {
                const askPrice = new BigNumber(ticker.askPrice)
                return {
                    symbol,
                    left: new BigNumber(ticker.askQty).times(askPrice),
                    right: new BigNumber(ticker.askQty),
                    exchangeRate: new BigNumber(1).dividedBy(askPrice),
                    availableLeftDecimalPlaces: new BigNumber(priceFilter.tickSize).dp(),
                    minLeft: new BigNumber(priceFilter.minPrice),
                    minRight: new BigNumber(lotSizeFilter.minQty)
                }
            } else {
                const bidPrice = new BigNumber(ticker.bidPrice)
                return {
                    symbol,
                    left: new BigNumber(ticker.bidQty),
                    right: new BigNumber(ticker.bidQty).times(bidPrice),
                    exchangeRate: new BigNumber(bidPrice),
                    availableLeftDecimalPlaces: new BigNumber(lotSizeFilter.stepSize).dp(),
                    minLeft: new BigNumber(lotSizeFilter.minQty),
                    minRight: new BigNumber(priceFilter.minPrice)
                }
            }
        }

        return this.candidateTradingChains.filter(it => chosenQuoteAssetMap.has(it.initAsset))
            .filter(it =>
                existLiquidity(it.stepOneSymbol, it.firstAction) &&
                existLiquidity(it.stepTwoSymbol, it.secondAction) &&
                existLiquidity(it.stepThreeSymbol, it.lastAction)
            ).map(it => {
                const {firstAction, stepOneSymbol, secondAction, stepTwoSymbol, lastAction, stepThreeSymbol} = it
                const pair1 = quantityPair(allBookTickers[stepOneSymbol], firstAction)
                const pair2 = quantityPair(allBookTickers[stepTwoSymbol], secondAction)
                const pair3 = quantityPair(allBookTickers[stepThreeSymbol], lastAction)
                if (pair1.right.gt(pair2.left)) {
                    pair1.left = pair1.left.dividedBy(pair1.right.dividedBy(pair2.left))
                    pair1.right = pair2.left
                } else if (pair1.right.lt(pair2.left)) {
                    pair2.right = pair2.right.dividedBy(pair2.left.dividedBy(pair1.right))
                    pair2.left = pair2.right
                }
                if (pair2.right.gt(pair3.left)) {
                    const times = pair2.right.dividedBy(pair3.left)
                    pair2.right = pair3.left
                    pair2.left = pair2.left.dividedBy(times)
                    pair1.right = pair1.right.dividedBy(times)
                    pair1.left = pair1.left.dividedBy(times)
                } else if (pair2.right.lt(pair3.left)) {
                    pair3.right = pair3.right.dividedBy(pair3.left.dividedBy(pair2.right))
                    pair3.left = pair2.right
                }
                const stepOneAvailableLeftDecimalPlaces = pair1.availableLeftDecimalPlaces
                const stepOneLeftQuantity = pair1.left.decimalPlaces(stepOneAvailableLeftDecimalPlaces, 1)
                if (stepOneLeftQuantity.lt(pair1.minLeft)) return null
                const stepOneRightQuantity = stepOneLeftQuantity.times(pair1.exchangeRate).decimalPlaces(8, 1)
                if (stepOneRightQuantity.lt(pair1.minRight)) return null
                const stepTwoAvailableLeftDecimalPlaces = pair2.availableLeftDecimalPlaces
                const stepTwoLeftQuantity = stepOneRightQuantity.decimalPlaces(stepTwoAvailableLeftDecimalPlaces, 1)
                const firstAssetRemain = stepOneRightQuantity.minus(stepTwoLeftQuantity)
                if (stepTwoLeftQuantity.lt(pair2.minLeft)) return null
                const stepTwoRightQuantity = stepTwoLeftQuantity.times(pair2.exchangeRate).decimalPlaces(8, 1)
                if (stepTwoRightQuantity.lt(pair2.minRight)) return null
                const stepThreeAvailableLeftDecimalPlaces = pair3.availableLeftDecimalPlaces
                const stepThreeLeftQuantity = stepTwoRightQuantity.decimalPlaces(stepThreeAvailableLeftDecimalPlaces, 1)
                const secondAssetRemain = stepTwoRightQuantity.minus(stepThreeLeftQuantity)
                if (stepThreeLeftQuantity.lt(pair3.minLeft)) return null
                const stepThreeRightQuantity = stepThreeLeftQuantity.times(pair3.exchangeRate).decimalPlaces(8, 1)
                const profit = stepThreeRightQuantity.minus(stepOneLeftQuantity).dividedBy(stepOneLeftQuantity)
                return {
                    ...it,
                    minInitAsset: pair1.minLeft,
                    stepOneLeftQuantity,
                    stepOneAvailableLeftDecimalPlaces,
                    stepOneRightQuantity,
                    firstAssetRemain,
                    stepTwoLeftQuantity,
                    stepTwoAvailableLeftDecimalPlaces,
                    stepTwoRightQuantity,
                    secondAssetRemain,
                    stepThreeLeftQuantity,
                    stepThreeAvailableLeftDecimalPlaces,
                    stepThreeRightQuantity,
                    profit
                }
            }).filter(it => it != null) as ValuableTradingChain[]
    }
}
