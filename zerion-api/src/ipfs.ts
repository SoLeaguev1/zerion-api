import { create } from 'ipfs-http-client';
import type { WalletSnapshot } from './merkle.js';

const IPFS_API_URL = process.env.IPFS_API_URL || 'https://ipfs.infura.io:5001';
const IPFS_PROJECT_ID = process.env.IPFS_PROJECT_ID || '';
const IPFS_PROJECT_SECRET = process.env.IPFS_PROJECT_SECRET || '';

const auth =
  IPFS_PROJECT_ID && IPFS_PROJECT_SECRET
    ? 'Basic ' + Buffer.from(IPFS_PROJECT_ID + ':' + IPFS_PROJECT_SECRET).toString('base64')
    : undefined;

export const ipfs = create({
  url: IPFS_API_URL,
  headers: auth ? { authorization: auth } : {},
});

export interface BattleSnapshot {
  battleId: string;
  startTime: number;
  endTime: number;
  players: string[];
  snapshots: WalletSnapshot[];
  winner: string;
  winnerAmount: number;
  bettingPayouts: { bettor: string; amount: number }[];
  merkleRoot: string;
}

export async function uploadSnapshotToIPFS(snapshot: BattleSnapshot): Promise<string> {
  const data = JSON.stringify(snapshot, null, 2);
  const result = await ipfs.add(data);
  return result.cid.toString();
}

export async function getSnapshotFromIPFS(cid: string): Promise<BattleSnapshot> {
  const chunks = [];
  for await (const chunk of ipfs.cat(cid)) {
    chunks.push(chunk);
  }
  const data = Buffer.concat(chunks).toString('utf-8');
  return JSON.parse(data);
}
