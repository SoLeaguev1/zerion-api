import { MerkleTree } from 'merkletreejs';
import keccak256 from 'keccak256';

export interface WalletSnapshot {
  player: string;
  totalValue: number;
  percentageChange: number;
  rank: number;
  timestamp: number;
  tokens?: any[];
}

export interface BattleResult {
  battleId: string;
  winner: string;
  winnerAmount: number;
  bettingPayouts: { bettor: string; amount: number }[];
}

export function hashLeaf(data: { player: string; amount: number }): Buffer {
  const encoded = Buffer.concat([
    Buffer.from(data.player),
    Buffer.from(data.amount.toString().padStart(32, '0')),
  ]);
  return keccak256(encoded);
}

export function generateMerkleTree(
  battleResult: BattleResult
): {
  tree: MerkleTree;
  root: string;
  leaves: { player: string; amount: number; hash: Buffer }[];
} {
  const allPayouts = [
    { player: battleResult.winner, amount: battleResult.winnerAmount },
    ...battleResult.bettingPayouts.map(bp => ({ player: bp.bettor, amount: bp.amount })),
  ];

  const leaves = allPayouts.map((payout) => ({
    player: payout.player,
    amount: payout.amount,
    hash: hashLeaf(payout),
  }));

  const tree = new MerkleTree(
    leaves.map((l) => l.hash),
    keccak256,
    { sortPairs: true }
  );

  const root = tree.getRoot().toString('hex');

  return { tree, root, leaves };
}

export function getMerkleProof(
  tree: MerkleTree,
  leafHash: Buffer
): string[] {
  return tree.getProof(leafHash).map((p) => p.data.toString('hex'));
}

export function calculateWinner(snapshots: WalletSnapshot[]): string {
  const sorted = [...snapshots].sort((a, b) => b.percentageChange - a.percentageChange);
  return sorted[0].player;
}

export function calculateBettingPayouts(
  bets: { bettor: string; predictedWinner: string; amount: number }[],
  actualWinner: string
): { bettor: string; amount: number }[] {
  const correctBets = bets.filter((b) => b.predictedWinner === actualWinner);

  if (correctBets.length === 0) {
    return [];
  }

  const totalCorrectBets = correctBets.reduce((sum, b) => sum + b.amount, 0);
  const totalPool = bets.reduce((sum, b) => sum + b.amount, 0);

  return correctBets.map((bet) => ({
    bettor: bet.bettor,
    amount: Math.floor((bet.amount / totalCorrectBets) * totalPool),
  }));
}
