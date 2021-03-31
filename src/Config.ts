export interface TradingPairFilter {
    enable: boolean
    blackList: string[]
    quoteVolumeLimit: number
    volumeLimit: number
    tradeCountLimit: number
}

export interface OrderSetting {
    enable: boolean
    interval: number
    useBestInitQuantity: boolean
    maxInvestmentRatio: number
    onlyProfitGreaterEqualThan: number
}
