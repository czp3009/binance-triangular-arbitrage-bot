export function getPair(asset: string, otherAsset: string, side: string) {
    return side === "BUY" ? `${otherAsset}${asset}` : `${asset}${otherAsset}`
}
