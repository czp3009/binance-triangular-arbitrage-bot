import proxy from "node-global-proxy"
import config from "../config/config.json"
import {Bot} from "./Bot";
import BigNumber from "bignumber.js";

async function main() {
    //proxy
    if (config.proxy.enable) {
        proxy.setConfig({
            http: config.proxy.http,
            https: config.proxy.https,
        })
        proxy.start()
    }
    //start bot
    const bot = new Bot(
        config.api.apiKey,
        config.api.apiSecret,
        config.quoteAssets,
        new BigNumber(config.investmentRatio),
        new BigNumber(config.onlyProfitGreaterEqualThan),
        config.api.httpBase ?? undefined
    )
    await bot.init()
    console.log("Bot start")
    console.log("Note that please don't manually perform spot trade while bot running!")
}

main().then(() => {
    console.log("Exit")
}).catch(console.log)
