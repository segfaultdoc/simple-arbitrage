import { Contract, providers, Wallet } from 'ethers'
import { BUNDLER_ABI } from './abi'
import { Market } from './Market'
import { FACTORY_ADDRESSES } from './addresses'
import { Arbitrage } from './Arbitrage'
import { get } from 'https'
import ethereumjs_common from 'ethereumjs-common'

const BASE_CHAIN: string = process.env.BASE_CHAIN || ''
const CHAIN_NAME: string = process.env.CHAIN_NAME || ''
const NET_ID: number = parseInt( process.env.NET_ID || '0' )
const CHAIN_ID: number = parseInt( process.env.CHAIN_ID || '0' )
const HARD_FORK: string = process.env.HARD_FORK || ''
const RPC_URL: string = process.env.RPC_URL || ''
const PRIVATE_KEY: string = process.env.PRIVATE_KEY || ''
const HEALTHCHECK_URL: string = process.env.HEALTHCHECK_URL || ''
const BUNDLER_CONTRACT_ADDR: string = process.env.BUNDLER_CONTRACT_ADDR || ''

const validateEnvs = () => {
	const exit = ( envVar: string ) => {
		console.warn( `Must provide ${envVar} environment variable` )
		process.exit( 1 )
	}
	if ( BASE_CHAIN === '' ) 
		exit( 'BASE_CHAIN' )
	if ( CHAIN_NAME === '' ) 
		exit( 'CHAIN_NAME' )
	if ( NET_ID === 0 )
		exit( 'NET_ID' )
	if ( CHAIN_ID === 0 )
		exit( 'CHAIN_ID' )
	if ( HARD_FORK === '' ) 
		exit( 'HARD_FORK' )
	if ( RPC_URL === '' ) 
		exit( 'HARD_FORK' )
	if ( PRIVATE_KEY === '' )
		exit( 'PRIVATE_KEY' )
	if ( BUNDLER_CONTRACT_ADDR === '' )
		exit( 'BUNDLER_CONTRACT_ADDR' )
}
validateEnvs()

ethereumjs_common.forCustomChain( 
	BASE_CHAIN,
	{
		name: CHAIN_NAME,
		networkId: NET_ID,
		chainId: CHAIN_ID,
	},
	HARD_FORK,
)

function healthcheck() {
	if ( HEALTHCHECK_URL === '' ) {
		return
	}
	get( HEALTHCHECK_URL ).on( 'error', console.error )
}

async function main() {
	const provider = new providers.StaticJsonRpcProvider( RPC_URL )
	const arbitrageSigningWallet = new Wallet( PRIVATE_KEY )
	console.log( 'Searcher Wallet Address: ' + await arbitrageSigningWallet.getAddress() )
	const arbitrage = new Arbitrage(
		arbitrageSigningWallet,
		new Contract( BUNDLER_CONTRACT_ADDR, BUNDLER_ABI, provider ),
	)

	const markets = await Market.getUniswapMarketsByToken( provider, FACTORY_ADDRESSES )
	provider.on( 'block', async () => {
		await Market.updateReserves( provider, markets.allMarketPairs )
		const bestCrossedMarkets = await arbitrage.evaluateMarkets( markets.marketsByToken )
		if ( bestCrossedMarkets.length === 0 ) {
			console.log( 'No crossed markets' )
			return
		}
		bestCrossedMarkets.forEach( Arbitrage.printCrossedMarket )
		try {
			await arbitrage.takeCrossedMarkets( bestCrossedMarkets )
			healthcheck()
		} catch ( err ) {
			console.error( err )
		}
	} )
}

main()
