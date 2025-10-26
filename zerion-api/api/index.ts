import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fetchWalletSnapshot } from '../src/oracle.js';
import type { Request, Response } from 'express';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'oracle-backend' });
});

app.get('/api/wallet/:address/snapshot', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const snapshot = await fetchWalletSnapshot(address);

    if (!snapshot) {
      return res.status(404).json({ error: 'Wallet snapshot not found' });
    }

    res.json(snapshot);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/tokens/top', async (req: Request, res: Response) => {
  try {
    const ZERION_API_KEY = process.env.ZERION_API_KEY || '';
    const searchTerms = ['SOL', 'USDC', 'USDT', 'BONK', 'JUP', 'RAY', 'ORCA', 'MNGO', 'SAMO', 'STEP'];

    const allTokens: any[] = [];

    for (const term of searchTerms) {
      try {
        const response = await fetch(
          `https://api.zerion.io/v1/fungibles/?currency=usd&filter%5Bsearch_query%5D=${term}`,
          {
            headers: {
              authorization: `Basic ${Buffer.from(ZERION_API_KEY + ':').toString('base64')}`,
              accept: 'application/json',
            },
          }
        );

        if (!response.ok) {
          continue;
        }

        const data: any = await response.json();
        const tokens = data.data || [];

        const solanaTokens = tokens
          .filter((token: any) => {
            const chainId = token.attributes?.implementations?.[0]?.chain_id || '';
            const price = token.attributes?.market_data?.price || 0;
            const symbol = token.attributes?.symbol || '';
            return chainId === 'solana' && price > 0 && symbol.toUpperCase() === term.toUpperCase();
          })
          .map((token: any) => ({
            id: token.id,
            symbol: token.attributes?.symbol || 'UNKNOWN',
            name: token.attributes?.name || 'Unknown Token',
            price: token.attributes?.market_data?.price || 0,
            change24h: token.attributes?.market_data?.changes?.percent_1d || 0,
            marketCap: token.attributes?.market_data?.market_cap || 0,
            icon: token.attributes?.icon?.url || null,
          }));

        if (solanaTokens.length > 0) {
          allTokens.push(...solanaTokens);
        }
      } catch (error) {
        console.error(`Error searching for ${term}:`, error);
      }
    }

    const tokensBySymbol = allTokens.reduce((acc: any, token) => {
      const symbol = token.symbol.toUpperCase();
      if (!acc[symbol] || token.marketCap > acc[symbol].marketCap) {
        acc[symbol] = token;
      }
      return acc;
    }, {});

    const uniqueTokens = Object.values(tokensBySymbol);
    const sortedTokens = uniqueTokens.sort((a: any, b: any) => b.marketCap - a.marketCap);

    res.json(sortedTokens);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tokens/prices', async (req: Request, res: Response) => {
  try {
    const { tokens } = req.body;

    if (!tokens || !Array.isArray(tokens)) {
      return res.status(400).json({ error: 'Invalid tokens array' });
    }

    const ZERION_API_KEY = process.env.ZERION_API_KEY || '';

    const prices = await Promise.all(
      tokens.map(async (tokenId: string) => {
        try {
          const url = `https://api.zerion.io/v1/fungibles/${tokenId}?currency=usd`;
          const response = await fetch(url, {
            headers: {
              authorization: `Basic ${Buffer.from(ZERION_API_KEY + ':').toString('base64')}`,
              accept: 'application/json',
            },
          });

          if (!response.ok) {
            return {
              symbol: tokenId,
              price: 0,
              change24h: 0,
            };
          }

          const data: any = await response.json();
          return {
            symbol: data.data?.attributes?.symbol || tokenId,
            price: data.data?.attributes?.market_data?.price || 0,
            change24h: data.data?.attributes?.market_data?.changes?.percent_1d || 0,
          };
        } catch (error) {
          return {
            symbol: tokenId,
            price: 0,
            change24h: 0,
          };
        }
      })
    );

    res.json(prices);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default app;
