import axios from 'axios';

export interface SentimentData {
  fearGreedIndex: number;       // 0-100
  fearGreedLabel: string;       // "Extreme Fear" etc
  socialSentiment?: number;     // -1 to 1
  newsScore?: number;           // -1 to 1
  trendingCoins?: string[];
  timestamp: number;
}

interface FearGreedResponse {
  data: Array<{
    value: string;
    value_classification: string;
    timestamp: string;
  }>;
}

interface CryptoPanicPost {
  title: string;
  published_at: string;
  currencies?: Array<{ code: string }>;
  votes?: {
    negative: number;
    positive: number;
    important: number;
  };
}

interface CryptoPanicResponse {
  results: CryptoPanicPost[];
}

export class SentimentService {
  private fearGreedCache: { value: number; label: string; timestamp: number } | null = null;
  private newsScoreCache: { score: number; timestamp: number } | null = null;
  private readonly cacheTtlMs = 5 * 60 * 1000; // 5 minutes

  constructor(private readonly cryptoPanicKey?: string) {}

  // Fear & Greed from Alternative.me (free, no key)
  async getFearGreed(): Promise<{ value: number; label: string }> {
    const now = Date.now();
    
    // Return cached result if still valid
    if (this.fearGreedCache && (now - this.fearGreedCache.timestamp) < this.cacheTtlMs) {
      return { value: this.fearGreedCache.value, label: this.fearGreedCache.label };
    }

    try {
      const response = await axios.get<FearGreedResponse>('https://api.alternative.me/fng/?limit=1', {
        timeout: 10000,
        headers: {
          'User-Agent': 'LumenLink/1.0'
        }
      });

      if (response.data?.data?.[0]) {
        const data = response.data.data[0];
        const value = parseInt(data.value, 10);
        const label = data.value_classification;
        
        this.fearGreedCache = { value, label, timestamp: now };
        return { value, label };
      }
      
      throw new Error('Invalid fear & greed response format');
    } catch (error) {
      console.warn('Failed to fetch Fear & Greed index, using default:', error);
      // Return neutral values on error
      return { value: 50, label: 'Neutral' };
    }
  }

  // News sentiment from CryptoPanic (has key in .env as CRYPTOPANIC_API_KEY)
  async getNewsSentiment(currency: string = 'BTC'): Promise<number> {
    const now = Date.now();
    
    // Return cached result if still valid
    if (this.newsScoreCache && (now - this.newsScoreCache.timestamp) < this.cacheTtlMs) {
      return this.newsScoreCache.score;
    }

    if (!this.cryptoPanicKey) {
      console.warn('CryptoPanic API key not configured, returning neutral news sentiment');
      return 0;
    }

    try {
      const response = await axios.get<CryptoPanicResponse>('https://cryptopanic.com/api/v1/posts/', {
        params: {
          auth_token: this.cryptoPanicKey,
          currencies: currency,
          filter: 'hot',
          page_size: 50
        },
        timeout: 15000,
        headers: {
          'User-Agent': 'LumenLink/1.0'
        }
      });

      if (!response.data?.results?.length) {
        console.warn('No news articles found from CryptoPanic');
        this.newsScoreCache = { score: 0, timestamp: now };
        return 0;
      }

      // Calculate sentiment score from votes
      let totalScore = 0;
      let totalVotes = 0;

      for (const post of response.data.results) {
        if (post.votes) {
          const positive = post.votes.positive || 0;
          const negative = post.votes.negative || 0;
          const important = post.votes.important || 0;
          
          const articleVotes = positive + negative + important;
          if (articleVotes > 0) {
            // Score: -1 (all negative) to +1 (all positive), weight by importance
            const articleScore = ((positive + important * 0.5 - negative) / articleVotes);
            totalScore += articleScore * articleVotes;
            totalVotes += articleVotes;
          }
        }
      }

      const newsScore = totalVotes > 0 ? Math.max(-1, Math.min(1, totalScore / totalVotes)) : 0;
      this.newsScoreCache = { score: newsScore, timestamp: now };
      return newsScore;

    } catch (error) {
      console.warn('Failed to fetch news sentiment from CryptoPanic:', error);
      // Return neutral sentiment on error
      this.newsScoreCache = { score: 0, timestamp: now };
      return 0;
    }
  }

  // Combined sentiment score
  async getSentiment(): Promise<SentimentData> {
    const [fearGreed, newsScore] = await Promise.allSettled([
      this.getFearGreed(),
      this.getNewsSentiment()
    ]);

    const fearGreedValue = fearGreed.status === 'fulfilled' ? fearGreed.value : { value: 50, label: 'Neutral' };
    const newsScoreValue = newsScore.status === 'fulfilled' ? newsScore.value : 0;

    // Normalize fear & greed to -1 to 1 scale (0 = extreme fear, 100 = extreme greed)
    const normalizedFearGreed = (fearGreedValue.value - 50) / 50;

    // Combine social sentiment (currently just news score, can be extended with LunarCrush later)
    const socialSentiment = newsScoreValue;

    return {
      fearGreedIndex: fearGreedValue.value,
      fearGreedLabel: fearGreedValue.label,
      socialSentiment,
      newsScore: newsScoreValue,
      trendingCoins: [], // TODO: Add trending coins from CoinGecko
      timestamp: Date.now()
    };
  }
}