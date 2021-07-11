import * as _ from 'lodash'
import { BigNumber, Contract, Wallet } from 'ethers'
import { WETH_ADDRESS } from './addresses'
import { Market } from './Market'
import { ETHER, bigNumberToDecimal } from './utils'

export interface CrossedMarketDetails {
	profit: BigNumber,
	volume: BigNumber,
	tokenAddress: string,
	buyFromMarket: EthMarket,
	sellToMarket: EthMarket,
}

export type MarketsByToken = { [tokenAddress: string]: Array<EthMarket> }

// TODO: implement binary search (assuming linear/exponential global maximum profitability)
const TEST_VOLUMES = [
	ETHER.div( 100 ),
	ETHER.div( 10 ),
	ETHER.div( 6 ),
	ETHER.div( 4 ),
	ETHER.div( 2 ),
	ETHER.div( 1 ),
	ETHER.mul( 2 ),
	ETHER.mul( 5 ),
	ETHER.mul( 10 ),
]

export function getBestCrossedMarket(
	crossedMarkets: Array<EthMarket>[],
	tokenAddress: string, 
): CrossedMarketDetails | undefined {
	
	let bestCrossedMarket: CrossedMarketDetails | undefined = undefined
	for ( const crossedMarket of crossedMarkets ) {
		const sellToMarket = crossedMarket[ 0 ]
		const buyFromMarket = crossedMarket[ 1 ]
		for ( const size of TEST_VOLUMES ) {
			const tokensOutFromBuyingSize = buyFromMarket.getTokensOut( WETH_ADDRESS, tokenAddress, size )
			const proceedsFromSellingTokens = sellToMarket.getTokensOut( tokenAddress, WETH_ADDRESS, tokensOutFromBuyingSize )
			const profit = proceedsFromSellingTokens.sub( size )
			if ( bestCrossedMarket !== undefined && profit.lt( bestCrossedMarket.profit ) ) {
				// If the next size up lost value, meet halfway. TODO: replace with real binary search
				const trySize = size.add( bestCrossedMarket.volume ).div( 2 )
				const tryTokensOutFromBuyingSize = buyFromMarket.getTokensOut( WETH_ADDRESS, tokenAddress, trySize )
				const tryProceedsFromSellingTokens = sellToMarket.getTokensOut( tokenAddress, WETH_ADDRESS, tryTokensOutFromBuyingSize )
				const tryProfit = tryProceedsFromSellingTokens.sub( trySize )
				if ( tryProfit.gt( bestCrossedMarket.profit ) ) {
					bestCrossedMarket = {
						volume: trySize,
						profit: tryProfit,
						tokenAddress,
						sellToMarket,
						buyFromMarket,
					}
				}
				break
			}
			bestCrossedMarket = {
				volume: size,
				profit: profit,
				tokenAddress,
				sellToMarket,
				buyFromMarket,
			}
		}
	}
	return bestCrossedMarket
}

export class Arbitrage {
	private bundleExecutorContract: Contract;
	private executorWallet: Wallet;

	constructor( 
		executorWallet: Wallet,
		bundleExecutorContract: Contract, 
	) {
		this.executorWallet = executorWallet
		this.bundleExecutorContract = bundleExecutorContract
	}

	static printCrossedMarket( crossedMarket: CrossedMarketDetails ): void {
		const buyTokens = crossedMarket.buyFromMarket.tokens
		const sellTokens = crossedMarket.sellToMarket.tokens
		console.log(
			`Profit: ${bigNumberToDecimal( crossedMarket.profit )} Volume: ${bigNumberToDecimal( crossedMarket.volume )}\n` +
			`${crossedMarket.buyFromMarket.protocol} (${crossedMarket.buyFromMarket.marketAddress})\n` +
			`  ${buyTokens[ 0 ]} => ${buyTokens[ 1 ]}\n` +
			`${crossedMarket.sellToMarket.protocol} (${crossedMarket.sellToMarket.marketAddress})\n` +
			`  ${sellTokens[ 0 ]} => ${sellTokens[ 1 ]}\n` +
			'\n',
		)
	}


	async evaluateMarkets( marketsByToken: MarketsByToken ): Promise<Array<CrossedMarketDetails>> {
		const bestCrossedMarkets = new Array<CrossedMarketDetails>()

		for ( const tokenAddress in marketsByToken ) {
			const markets = marketsByToken[ tokenAddress ]
			const pricedMarkets = _.map( markets, ( ethMarket: EthMarket ) => {
				return {
					ethMarket: ethMarket,
					buyTokenPrice: ethMarket.getTokensIn( tokenAddress, WETH_ADDRESS, ETHER.div( 100 ) ),
					sellTokenPrice: ethMarket.getTokensOut( WETH_ADDRESS, tokenAddress, ETHER.div( 100 ) ),
				}
			} )

			const crossedMarkets = new Array<Array<EthMarket>>()
			for ( const pricedMarket of pricedMarkets ) {
				_.forEach( pricedMarkets, pm => {
					if ( pm.sellTokenPrice.gt( pricedMarket.buyTokenPrice ) ) {
						crossedMarkets.push( [ pricedMarket.ethMarket, pm.ethMarket ] )
					}
				} )
			}

			const bestCrossedMarket = getBestCrossedMarket( crossedMarkets, tokenAddress )
			if ( bestCrossedMarket !== undefined && bestCrossedMarket.profit.gt( ETHER.div( 1000 ) ) ) {
				bestCrossedMarkets.push( bestCrossedMarket )
			}
		}
		bestCrossedMarkets.sort( ( a, b ) => a.profit.lt( b.profit ) ? 1 : a.profit.gt( b.profit ) ? -1 : 0 )
		
		return bestCrossedMarkets
	}

	async takeCrossedMarkets( bestCrossedMarkets: CrossedMarketDetails[] ): Promise<void> {
		for ( const bestCrossedMarket of bestCrossedMarkets ) {

			console.log( 'Send this much WETH', bestCrossedMarket.volume.toString(), 'get this much profit', bestCrossedMarket.profit.toString() )
			const buyCalls = await bestCrossedMarket.buyFromMarket.sellTokensToNextMarket( WETH_ADDRESS, bestCrossedMarket.volume, bestCrossedMarket.sellToMarket )
			const inter = bestCrossedMarket.buyFromMarket.getTokensOut( WETH_ADDRESS, bestCrossedMarket.tokenAddress, bestCrossedMarket.volume )
			const sellCallData = await bestCrossedMarket.sellToMarket.sellTokens( bestCrossedMarket.tokenAddress, inter, this.bundleExecutorContract.address )

			const targets: Array<string> = [ ...buyCalls.targets, bestCrossedMarket.sellToMarket.marketAddress ]
			const payloads: Array<string> = [ ...buyCalls.data, sellCallData ]
			console.log( { targets, payloads } )
			const tx = await this.bundleExecutorContract.populateTransaction
				.uniswapWeth( bestCrossedMarket.volume, targets, payloads, {
					gasPrice: BigNumber.from( 0 ),
					gasLimit: BigNumber.from( 1000000 ),
				} )

			try {
				const estimateGas = await this.bundleExecutorContract.provider.estimateGas(
					{
						...tx,
						from: this.executorWallet.address,
					} )
				if ( estimateGas.gt( 1400000 ) ) {
					console.log( 'EstimateGas succeeded, but suspiciously large: ' + estimateGas.toString() )
					continue
				}
				tx.gasLimit = estimateGas.mul( 2 )
			} catch ( e ) {
				console.warn( `Estimate gas failure for ${JSON.stringify( bestCrossedMarket )}` )
				continue
			}

			const signedTx = await this.executorWallet.signTransaction( tx )
			const resp = await this.bundleExecutorContract.provider.sendTransaction( signedTx )
			const receipt = await resp.wait()
			console.log( 'tx receipt: ', receipt )
			
			return
		}
		throw new Error( 'No arbitrage submitted to relay' )
	}
}
