var api = require('./api')
const _ = require('underscore')
const cheerio = require('cheerio')
const jsdiff = require('diff')
var configuration
try {
    configuration = require('./config.json');
} catch (e) {
    return huf.log(null, 'error', 'Missing, config.json file please create your config file before using hufbot.')
}

const request = require('request').defaults({
    timeout: 30000
})

var og

var added = []
var removed = []
var matches = []

if (configuration.notifyWhenNewItemsFound) {
    api.log('info', 'Looking for new items...')
}

if (configuration.notifyWhenOnKeywordMatch) {
    api.log('info', 'Looking for items matching your keywords...')
}

if (configuration.slackBot.active) {
    const Bot = require('slackbots')
    var slackBot = new Bot({
        name: 'Shopify Monitor',
        token: configuration.slackBot.token
    })
    slackBot.on('start', function() {
        slackBot.postMessageToChannel(configuration.slackBot.channel, 'Shopify Monitor currently active ◕‿◕', configuration.slackBot.settings);
    })
}

function getInitialData() {
    api.log('info', 'Getting initial data...')
    api.log('info', `Interval set for every ${configuration.interval}ms`)
    api.getItems((response, err) => {
        if (err || response == null) {
            if (configuration.autoRetryOnCrash == true) {
                api.log('error', 'Site Crashed, retrying...')
                return getInitialData()
            } else {
                api.log('error', err)
                return process.exit()
            }
        }
        og = response.productDetails
        return seek()
    })
}

getInitialData()

function seek() {

    var a = configuration.keywords
    var ending = [a.slice(0, -1).join(', '), a.slice(-1)[0]].join(a.length < 2 ? '' : ' and ');

    api.log('info', `Now seeking for items with the keywords ${ending}`)

    var newbatch

    var interval = setInterval(function() {
        api.getItems((response, err) => {
            if (err || response == null) {
                if (config.autoRetryOnCrash == true) {
                    api.log('error', 'Site Crashed, retrying...')
                    return seek()
                } else {
                    api.log('error', err)
                    return process.exit()
                }
            }

            newbatch = response.productDetails

            // this feature works 100%
            if (configuration.notifyWhenOnKeywordMatch) {
                var x
                for (x = 0; x < configuration.keywords.length; x++) {
                    // looks if keywords matches any of the results
                    var products = response.productDetails.map(function(result, i) {
                        var parsedResult = JSON.parse(result)
                        var productToCompare = parsedResult.name.toLowerCase()
                        if (productToCompare.indexOf(configuration.keywords[x].toLowerCase()) > -1) {

                            var possibleMatch = _.where(matches, parsedResult)
                            if (possibleMatch.length === 0) {
                                api.log('success', `Match Found: "${parsedResult.name}"`)
                                if (configuration.slackBot.active) {
                                    var params = {
                                        username: "ShopifyMonitor",
                                        icon_url: "http://i.imgur.com/zks3PoZ.png",
                                        attachments: [{
                                            "title": parsedResult.name,
                                            "title_link": parsedResult.link,
                                            "pretext": "Keyword Match",
                                            "color": "#36a64f",
                                            "fields": [{
                                                    "title": "Product Name",
                                                    "value": parsedResult.name,
                                                    "short": "false"
                                                },
                                                {
                                                    "title": "Link",
                                                    "value": parsedResult.link,
                                                    "short": "true"
                                                },
                                                {
                                                    "title": "Price",
                                                    "value": parsedResult.price,
                                                    "short": "true"
                                                }
                                            ],
                                            "thumb_url": parsedResult.image
                                        }]
                                    }
                                    slackBot.postMessageToChannel(configuration.slackBot.channel, null, params);
                                }
                                matches.push(parsedResult);
                            }

                        }
                    })
                }
            }

            // this needs to be enhanced
            if (configuration.notifyWhenNewItemsFound) {

                // TODO: Convert stuff from test.js
                var diff = jsdiff.diffArrays(og, newbatch);

                var parsedOG = []
                var parsedNew = []
                var removed = []

                var newItems = []
                var restockedItems = []
                var removedItems = []
                var soldoutItems = []

                for (var i = 0; i < og.length; i++) {
                    parsedOG.push(JSON.parse(og[i]))
                }

                for (var i = 0; i < newbatch.length; i++) {
                    parsedNew.push(JSON.parse(newbatch[i]))
                }

                diff.forEach(function(part) {

                    if (part.added) {
                        var item
                        var diffAdded = []

                        for (var i = 0; i < part.value.length; i++) {
                            diffAdded.push(JSON.parse(part.value[i]))
                        }

                        for (var i = 0; i < diffAdded.length; i++) {
                            item = _.where(parsedOG, {
                                name: diffAdded[i].name
                            })
                            if (item.length === 0) {
                                // newly added item push to new items array
                                testNewItems.push(diffAdded[i].name)
                                console.log(`Item Added to Store: ${diffAdded[i].name}`)
                            } else if (item.length > 0) {
                                item = _.where(parsedOG, {
                                    name: diffAdded[i].name
                                })

                                if (diffAdded[i].status === "Available" && item[0].status === "Sold Out") {
                                    testRestockedItems.push(diffAdded[i])
                                    console.log(`Restocked Item: ${diffAdded[i].name}`)
                                }

                                if (diffAdded[i].status === "Sold Out" && item[0].status === "Available") {
                                    testSoldoutItems.push(diffAdded[i])
                                    console.log(`Item Sold Out: ${diffAdded[i].name}`)
                                }

                            }
                        }

                    } else if (part.removed) {
                        removed.push(part.value)
                        var diffRemoved = []
                        for (var i = 0; i < part.value.length; i++) {
                            diffRemoved.push(JSON.parse(part.value[i]))
                        }

                        for (var i = 0; i < diffRemoved.length; i++) {
                            item = _.where(parsedNew, {
                                name: diffRemoved[i].name
                            })

                            if (item.length === 0) {
                                testRemovedItems.push(diffRemoved[i])
                                console.log(`Item Removed from Store: ${parsedNew[i].name}`)
                            }

                        }

                    }
                });

                if (newItems.length === 0 || restockedItems.length === 0 || removedItems.length === 0 || soldoutItems.length === 0) {
                    api.log('warning', 'No changes found yet but still looking ヅ')
                    var parsedOG = []
                    var parsedNew = []
                    var removed = []
                    var newItems = []
                    var restockedItems = []
                    var removedItems = []
                    var soldoutItems = []
                } else {
                    og = newbatch
                }


            }

        })
    }, configuration.interval);
}
