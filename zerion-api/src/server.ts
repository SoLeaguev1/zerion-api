import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { initializeOracle, settleBattle, setMerkleRootOnChain, fetchWalletSnapshot } from './oracle.js';
import { getSnapshotFromIPFS } from './ipfs.js';
import { getMerkleProof, generateMerkleTree } from './merkle.js';
import type { BattleResult } from './merkle.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

if (process.env.ADMIN_KEYPAIR_PATH) {
  try {
    initializeOracle();
  } catch (error) {
    console.warn('Oracle initialization failed:', error);
  }
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'oracle-backend' });
});

app.get('/api/wallet/:address/snapshot', async (req, res) => {
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

app.post('/api/battle/:battleId/settle', async (req, res) => {
  try {
    const { battleId } = req.params;
    const { players, bets, battlePrizePool } = req.body;

    if (!players || !Array.isArray(players) || players.length === 0) {
      return res.status(400).json({ error: 'Invalid players array' });
    }

    if (!bets || !Array.isArray(bets)) {
      return res.status(400).json({ error: 'Invalid bets array' });
    }

    if (!battlePrizePool || typeof battlePrizePool !== 'number') {
      return res.status(400).json({ error: 'Invalid battle prize pool' });
    }

    const result = await settleBattle(battleId, players, bets, battlePrizePool);

    const txSignature = await setMerkleRootOnChain(result.merkleRoot);

    res.json({
      success: true,
      merkleRoot: result.merkleRoot,
      ipfsCid: result.ipfsCid,
      transactionSignature: txSignature,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/battle/:battleId/snapshot/:ipfsCid', async (req, res) => {
  try {
    const { ipfsCid } = req.params;
    const snapshot = await getSnapshotFromIPFS(ipfsCid);
    res.json(snapshot);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/merkle/proof', async (req, res) => {
  try {
    const { battleResult, player, amount } = req.body;

    if (!battleResult || !player || amount === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result: BattleResult = battleResult;
    const { tree, leaves } = generateMerkleTree(result);

    const targetLeaf = leaves.find((l) => l.player === player && l.amount === amount);

    if (!targetLeaf) {
      return res.status(404).json({ error: 'Player payout not found in battle result' });
    }

    const proof = getMerkleProof(tree, targetLeaf.hash);
    const leafHash = targetLeaf.hash.toString('hex');

    res.json({
      proof,
      leafHash,
      amount,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/tokens/top', async (req, res) => {
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
          console.log(`Search failed for ${term}:`, response.status);
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
    console.error('Error in /api/tokens/top:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tokens/prices', async (req, res) => {
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

app.listen(PORT);
