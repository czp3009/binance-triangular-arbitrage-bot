import proxy from "node-global-proxy"
import config from "../config/config.json"
import {Bot} from "./Bot";
import delay from "delay";

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
        config.tradingPairFilter,
        config.order,
        config.api.httpBase ?? undefined
    )
    await bot.init()
    console.log("Bot start")
    console.log("Note that please don't manually do spot trade while bot running!")
    //running
    while (true) {
        console.log("=".repeat(50))
        console.log(`Time: ${new Date()}`)
        await bot.performOnce()
        console.log("=".repeat(50))
        await delay(config.order.interval)
    }
}

main().then(() => {
    console.log("Exit")
}).catch(console.log)
