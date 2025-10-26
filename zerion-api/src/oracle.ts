import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { readFileSync } from 'fs';
import type { WalletSnapshot, BattleResult } from './merkle.js';
import {
  generateMerkleTree,
  calculateWinner,
  calculateBettingPayouts,
} from './merkle.js';
import { uploadSnapshotToIPFS } from './ipfs.js';
import type { BattleSnapshot } from './ipfs.js';

const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.devnet.solana.com';
const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || 'Fo5yHR18hNooLoFzxYcjpi5BoUx5rhnxhzVRetpVeSsY');
const ADMIN_KEYPAIR_PATH = process.env.ADMIN_KEYPAIR_PATH || '';

let connection: Connection;
let adminKeypair: Keypair;

export function initializeOracle() {
  connection = new Connection(SOLANA_RPC, 'confirmed');

  if (!ADMIN_KEYPAIR_PATH) {
    throw new Error('ADMIN_KEYPAIR_PATH not set');
  }

  const keypairData = JSON.parse(readFileSync(ADMIN_KEYPAIR_PATH, 'utf-8'));
  adminKeypair = Keypair.fromSecretKey(new Uint8Array(keypairData));
}

export async function fetchWalletSnapshot(walletAddress: string): Promise<WalletSnapshot | null> {
  const ZERION_API_KEY = process.env.ZERION_API_KEY || '';

  try {
    const [positionsResponse, portfolioResponse] = await Promise.all([
      fetch(
        `https://api.zerion.io/v1/wallets/${walletAddress}/positions/?filter[positions]=only_simple&currency=usd&filter[chain_ids]=solana&sort=value`,
        {
          headers: {
            authorization: `Basic ${Buffer.from(ZERION_API_KEY + ':').toString('base64')}`,
            accept: 'application/json',
          },
        }
      ),
      fetch(`https://api.zerion.io/v1/wallets/${walletAddress}/portfolio/?currency=usd`, {
        headers: {
          authorization: `Basic ${Buffer.from(ZERION_API_KEY + ':').toString('base64')}`,
          accept: 'application/json',
        },
      }),
    ]);

    if (!positionsResponse.ok) {
      console.error(`Zerion API failed for ${walletAddress}: ${positionsResponse.status}`);
      return null;
    }

    const positionsResult: any = await positionsResponse.json();
    const portfolioResult: any = portfolioResponse.ok ? await portfolioResponse.json() : null;

    let totalValue = 0;
    const tokens: any[] = [];

    positionsResult.data?.forEach((position: any) => {
      const value = position.attributes?.value || 0;
      totalValue += value;

      const fungibleInfo = position.attributes?.fungible_info;
      const fungibleId = position.relationships?.fungible?.data?.id;

      if (fungibleInfo && fungibleId) {
        tokens.push({
          symbol: fungibleInfo.symbol || 'UNKNOWN',
          name: fungibleInfo.name || 'Unknown Token',
          address: fungibleId,
          balance: position.attributes.quantity?.float || position.attributes.quantity || 0,
          valueUSD: value,
          priceChange24h: position.attributes?.changes?.percent_1d || 0,
        });
      }
    });

    const percentageChange = portfolioResult?.data?.attributes?.changes?.percent_1d || 0;

    if (tokens.length === 0) {
      console.log(`No tokens found for ${walletAddress} on Zerion`);
      return null;
    }

    return {
      player: walletAddress,
      totalValue,
      percentageChange,
      rank: 0,
      timestamp: Date.now(),
      tokens,
    };
  } catch (error) {
    console.error(`Error fetching wallet snapshot for ${walletAddress}:`, error);
    return null;
  }
}

export async function settleBattle(
  battleId: string,
  players: string[],
  bets: { bettor: string; predictedWinner: string; amount: number }[],
  battlePrizePool: number
): Promise<{ merkleRoot: string; ipfsCid: string }> {
  const snapshots: WalletSnapshot[] = [];
  for (const player of players) {
    const snapshot = await fetchWalletSnapshot(player);
    if (snapshot) {
      snapshots.push(snapshot);
    }
  }

  const sortedSnapshots = snapshots.sort((a, b) => b.percentageChange - a.percentageChange);
  sortedSnapshots.forEach((s, idx) => {
    s.rank = idx + 1;
  });

  const winner = calculateWinner(sortedSnapshots);
  const bettingPayouts = calculateBettingPayouts(bets, winner);

  const battleResult: BattleResult = {
    battleId,
    winner,
    winnerAmount: battlePrizePool,
    bettingPayouts,
  };

  const { tree, root, leaves } = generateMerkleTree(battleResult);

  const battleSnapshot: BattleSnapshot = {
    battleId,
    startTime: Date.now(),
    endTime: Date.now(),
    players,
    snapshots: sortedSnapshots,
    winner,
    winnerAmount: battlePrizePool,
    bettingPayouts,
    merkleRoot: root,
  };

  const ipfsCid = await uploadSnapshotToIPFS(battleSnapshot);

  return {
    merkleRoot: root,
    ipfsCid,
  };
}

export async function setMerkleRootOnChain(merkleRoot: string): Promise<string> {
  const merkleRootBuffer = Buffer.from(merkleRoot, 'hex');
  const merkleRootArray = Array.from(merkleRootBuffer);

  const wallet = new Wallet(adminKeypair);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const program = new Program(
    require('../../backend/target/idl/contracts.json'),
    PROGRAM_ID,
    provider
  );

  const [globalStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('global_state')],
    PROGRAM_ID
  );

  const tx = await program.methods
    .setMerkleRoot(merkleRootArray)
    .accounts({
      globalState: globalStatePDA,
      admin: adminKeypair.publicKey,
    })
    .rpc();

  return tx;
}
