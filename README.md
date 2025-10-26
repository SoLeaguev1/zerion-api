# Oracle Backend API

A Solana-based oracle service for crypto trading battles with portfolio tracking and betting mechanics. Integrates with Zerion API for real-time wallet analysis and uses Merkle trees for trustless payout verification.

## Architecture

- **Express.js** REST API server
- **Solana Web3.js** + **Anchor** for blockchain interactions
- **Zerion API** integration for portfolio snapshots
- **IPFS** storage for battle results
- **Merkle trees** for cryptographic payout proofs

## API Endpoints

### Health Check
```
GET /health
```

### Wallet Analysis
```
GET /api/wallet/:address/snapshot
```
Fetches portfolio snapshot from Zerion API including token balances, USD values, and 24h changes.

### Battle Settlement
```
POST /api/battle/:battleId/settle
Body: { players: string[], bets: BetInfo[], battlePrizePool: number }
```
Settles trading battle by:
1. Fetching all player portfolio snapshots
2. Ranking by 24h percentage change
3. Calculating winner and betting payouts
4. Generating Merkle tree for payouts
5. Storing results on IPFS
6. Setting Merkle root on-chain

### Token Data
```
GET /api/tokens/top
POST /api/tokens/prices
Body: { tokens: string[] }
```
Returns Solana token prices and market data via Zerion API.

### Merkle Proofs
```
POST /api/merkle/proof
Body: { battleResult: BattleResult, player: string, amount: number }
```
Generates Merkle proof for payout verification.

### IPFS Retrieval
```
GET /api/battle/:battleId/snapshot/:ipfsCid
```
Retrieves battle snapshot from IPFS.

## Environment Variables

```bash
PORT=4000
SOLANA_RPC=https://api.devnet.solana.com
PROGRAM_ID=<your_solana_program_id>
ADMIN_KEYPAIR_PATH=<path_to_admin_keypair.json>
ZERION_API_KEY=<zerion_api_key>
```

## Setup

```bash
npm install
npm run dev        # Development with file watching
npm run build      # TypeScript compilation
npm start          # Production
```

## Deployment

Supports Vercel deployment via `vercel.json` configuration and Heroku via `Procfile`.

## Core Components

- `oracle.ts` - Zerion API integration and battle settlement logic
- `merkle.ts` - Merkle tree generation and proof verification
- `ipfs.ts` - IPFS storage for battle snapshots
- `server.ts` - Express API routes and middleware
