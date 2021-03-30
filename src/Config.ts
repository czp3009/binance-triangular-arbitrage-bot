export interface TradingPairFilter {
    enable: boolean
    blackList: string[],
    quoteVolumeLimit: number,
    volumeLimit: number,
    tradeSpeedLimit: number
}
