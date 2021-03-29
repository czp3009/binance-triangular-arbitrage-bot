import Binance from "binance-api-node"
import BigNumber from "bignumber.js";

export class Bot {
    private readonly client: import("binance-api-node").Binance
    private readonly quoteAssets: string[]
    private readonly investmentRatio: BigNumber
    private readonly onlyProfitGreaterEqualThan: BigNumber
    private initialized: boolean = false
    private chosenQuoteAssets: string[] = []

    constructor(
        apiKey: string, apiSecret: string,
        quoteAssets: string[],
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
            console.log(`${it.asset}: ${it.quantity.toString()}`)
        })
        this.chosenQuoteAssets = freeAssets.filter(it => this.quoteAssets.includes(it.asset)).map(it => it.asset)
        if (this.chosenQuoteAssets.length === 0) throw new Error("No quote asset is available")
        console.log("Chosen quote assets:")
        console.log(this.chosenQuoteAssets.join(", "))
        console.log("Analyze trading pairs...")
        await this.analyzeTradingPairs()
    }

    async findOutLucrativeTradeChain() {

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
        const exchangeInfo = await this.client.exchangeInfo()
        console.log()
    }
}
