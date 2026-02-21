import axios from 'axios';

export interface MarketOverview {
  btcDominance: number;
  ethDominance: number;
  totalMarketCap: number;
  totalVolume24h: number;
  activeCryptos: number;
}

export interface DefiTVL {
  name: string;
  tvl: number;
  change1d: number;
  chain: string;
}

interface CoinGeckoGlobalResponse {
  data: {
    active_cryptocurrencies: number;
    markets: number;
    total_market_cap: Record<string, number>;
    total_volume: Record<string, number>;
    market_cap_percentage: Record<string, number>;
  };
}

interface CoinGeckoTrendingResponse {
  coins: Array<{
    item: {
      id: string;
      name: string;
      symbol: string;
    };
  }>;
}

interface DefiLlamaProtocol {
  id: string;
  name: string;
  symbol: string;
  tvl: number;
  change_1d: number;
  chain?: string;
  chains?: string[];
}

export class OnChainService {
  private marketOverviewCache: { data: MarketOverview; timestamp: number } | null = null;
  private defiTvlCache: { data: DefiTVL[]; timestamp: number } | null = null;
  private trendingCoinsCache: { data: string[]; timestamp: number } | null = null;
  private readonly cacheTtlMs = 10 * 60 * 1000; // 10 minutes

  constructor() {}

  // BTC dominance & market overview from CoinGecko (free)
  async getMarketOverview(): Promise<MarketOverview> {
    const now = Date.now();
    
    // Return cached result if still valid
    if (this.marketOverviewCache && (now - this.marketOverviewCache.timestamp) < this.cacheTtlMs) {
      return this.marketOverviewCache.data;
    }

    try {
      const response = await axios.get<CoinGeckoGlobalResponse>('https://api.coingecko.com/api/v3/global', {
        timeout: 15000,
        headers: {
          'User-Agent': 'LumenLink/1.0'
        }
      });

      if (!response.data?.data) {
        throw new Error('Invalid CoinGecko global response format');
      }

      const data = response.data.data;
      const marketOverview: MarketOverview = {
        btcDominance: data.market_cap_percentage.btc || 0,
        ethDominance: data.market_cap_percentage.eth || 0,
        totalMarketCap: data.total_market_cap.usd || 0,
        totalVolume24h: data.total_volume.usd || 0,
        activeCryptos: data.active_cryptocurrencies || 0
      };

      this.marketOverviewCache = { data: marketOverview, timestamp: now };
      return marketOverview;

    } catch (error) {
      console.warn('Failed to fetch market overview from CoinGecko:', error);
      
      // Return default values on error
      const defaultOverview: MarketOverview = {
        btcDominance: 45,
        ethDominance: 15,
        totalMarketCap: 2000000000000, // $2T default
        totalVolume24h: 50000000000,   // $50B default
        activeCryptos: 10000
      };

      return defaultOverview;
    }
  }

  // Top DeFi TVL from DeFiLlama (free, no key)
  async getTopDefiTVL(limit: number = 20): Promise<DefiTVL[]> {
    const now = Date.now();
    
    // Return cached result if still valid
    if (this.defiTvlCache && (now - this.defiTvlCache.timestamp) < this.cacheTtlMs) {
      return this.defiTvlCache.data.slice(0, limit);
    }

    try {
      const response = await axios.get<DefiLlamaProtocol[]>('https://api.llama.fi/protocols', {
        timeout: 15000,
        headers: {
          'User-Agent': 'LumenLink/1.0'
        }
      });

      if (!Array.isArray(response.data)) {
        throw new Error('Invalid DeFiLlama protocols response format');
      }

      const protocols = response.data
        .filter((p) => p.tvl > 0)
        .sort((a, b) => b.tvl - a.tvl)
        .slice(0, Math.max(limit, 50)) // Cache more than requested
        .map((p): DefiTVL => ({
          name: p.name,
          tvl: p.tvl,
          change1d: p.change_1d || 0,
          chain: p.chain || (p.chains && p.chains.length > 0 ? (p.chains[0] || 'Multi-Chain') : 'Multi-Chain')
        }));

      this.defiTvlCache = { data: protocols, timestamp: now };
      return protocols.slice(0, limit);

    } catch (error) {
      console.warn('Failed to fetch DeFi TVL data from DeFiLlama:', error);
      
      // Return empty array on error
      return [];
    }
  }

  // Trending coins from CoinGecko
  async getTrendingCoins(): Promise<string[]> {
    const now = Date.now();
    
    // Return cached result if still valid
    if (this.trendingCoinsCache && (now - this.trendingCoinsCache.timestamp) < this.cacheTtlMs) {
      return this.trendingCoinsCache.data;
    }

    try {
      const response = await axios.get<CoinGeckoTrendingResponse>('https://api.coingecko.com/api/v3/search/trending', {
        timeout: 15000,
        headers: {
          'User-Agent': 'LumenLink/1.0'
        }
      });

      if (!response.data?.coins) {
        throw new Error('Invalid CoinGecko trending response format');
      }

      const trendingCoins = response.data.coins.map((coin) => coin.item.symbol.toUpperCase());
      
      this.trendingCoinsCache = { data: trendingCoins, timestamp: now };
      return trendingCoins;

    } catch (error) {
      console.warn('Failed to fetch trending coins from CoinGecko:', error);
      
      // Return default trending coins on error
      return ['BTC', 'ETH', 'SOL', 'ADA', 'DOT'];
    }
  }

  // Get combined on-chain and market data
  async getOnChainSummary(): Promise<{
    overview: MarketOverview;
    topDefi: DefiTVL[];
    trending: string[];
  }> {
    const [overview, topDefi, trending] = await Promise.allSettled([
      this.getMarketOverview(),
      this.getTopDefiTVL(10),
      this.getTrendingCoins()
    ]);

    return {
      overview: overview.status === 'fulfilled' ? overview.value : {
        btcDominance: 45,
        ethDominance: 15,
        totalMarketCap: 2000000000000,
        totalVolume24h: 50000000000,
        activeCryptos: 10000
      },
      topDefi: topDefi.status === 'fulfilled' ? topDefi.value : [],
      trending: trending.status === 'fulfilled' ? trending.value : ['BTC', 'ETH', 'SOL']
    };
  }
}