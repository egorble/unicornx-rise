# FantasyYC - UnicornX Dashboard

A blockchain-based fantasy sports game for Y Combinator startups on the Etherlink network. Collect NFT cards, compete in tournaments, and earn rewards based on real-time Twitter/X engagement scores.

## 🎮 Overview

- **Blockchain**: Etherlink Shadownet Testnet (Chain ID: 127823)
- **NFT Cards**: 19 YC startups with 5 rarity tiers (Common to Legendary)
- **Pack System**: Buy packs with 5 random cards for 5 XTZ
- **Tournaments**: Enter with 5 cards, compete for prize pools
- **Scoring**: Real-time Twitter engagement × rarity multipliers
- **Marketplace**: List, bid, auction NFT cards
- **Referral System**: 10% rewards for referrers

## 📁 Project Structure

```
fantasyyc/
├── contracts/              # Solidity smart contracts (UUPS upgradeable)
│   ├── UnicornX_NFT.sol           # ERC-721 NFT with rarity system
│   ├── PackOpener.sol             # Pack purchases & card generation
│   ├── TournamentManager.sol      # Tournament logic & prize distribution
│   └── MarketplaceV2.sol          # NFT marketplace (listings, bids, auctions)
│
├── front/                  # React + TypeScript + Vite frontend
│   ├── components/                # UI components
│   ├── hooks/                     # React hooks for blockchain/API
│   ├── lib/                       # Contracts, utils, cache
│   └── context/                   # Wallet & auth context
│
├── server/                 # Express.js backend (port 3003)
│   ├── index.js                   # API server
│   ├── db/                        # SQLite database (sql.js)
│   ├── jobs/                      # Daily scorer & tournament finalizer
│   ├── middleware/                # Auth, rate limiting, integrity checks
│   └── config/                    # Environment config
│
├── scripts/                # Deployment & utility scripts
│   ├── compile.js                 # Compile contracts with solc
│   ├── deploy.js                  # Deploy contracts to blockchain
│   ├── upgrade.js                 # Upgrade UUPS proxies
│   └── twitter-league-scorer.js   # Twitter API scorer
│
└── deployment-shadownet.json      # Contract addresses (tracked in git)
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- MetaMask or WalletConnect-compatible wallet
- Etherlink Shadownet XTZ (from [faucet](https://shadownet.faucet.etherlink.com/))

### 1. Install Dependencies

```bash
# Root dependencies (contracts)
npm install

# Frontend dependencies
cd front
npm install

# Backend dependencies
cd ../server
npm install
```

### 2. Environment Setup

Create `scripts/.env`:

```env
PRIVATE_KEY=0x...
RPC_URL=https://node.shadownet.etherlink.com
ADMIN_API_KEY=your-secret-admin-key
SCORE_HMAC_SECRET=your-secret-hmac-key
```

### 3. Smart Contracts

#### Compile Contracts

```bash
npm run compile
# Generates ABIs in build/ directory
```

#### Deploy Contracts

```bash
# Deploy to Shadownet testnet
node scripts/deploy.js shadownet

# Or to mainnet
node scripts/deploy.js mainnet
```

Deployment addresses are saved to `deployment-shadownet.json`.

#### Upgrade Contracts (UUPS)

```bash
node scripts/upgrade.js shadownet UnicornX_NFT
node scripts/upgrade.js shadownet PackOpener
node scripts/upgrade.js shadownet TournamentManager
node scripts/upgrade.js shadownet MarketplaceV2
```

### 4. Backend Server

```bash
cd server

# Initialize database
npm run init-db

# Start API server (port 3003)
npm start

# Or run with auto-reload
npm run dev
```

**API Endpoints:**
- `GET /api/leaderboard/:tournamentId` - Tournament leaderboard
- `GET /api/card-scores/:address` - Player's card scores
- `GET /api/top-startups` - Global startup rankings
- `GET /api/live-feed` - Real-time Twitter events
- `POST /api/users/register` - Create user profile (requires wallet signature)
- `POST /api/admin/run-scorer` - Trigger daily scorer (admin only)

### 5. Frontend

```bash
cd front

# Start dev server (port 5173)
npm run dev

# Build for production
npm run build
```

Access at `http://localhost:5173`

## 🎯 Smart Contract Architecture

### Contract Addresses (v6 - Shadownet)

```javascript
UnicornX_NFT:        0x172aC7aa7a6774559b1588E2F4426F7303a97cf1
PackOpener:          0x78b602DE1721FF85C0c07F2Db5CF253c73590BaF
TournamentManager:   0xc367886000da37447AC592fc3571ceb63184BF1b
MarketplaceV2:       0x5BCf9A613C117dacD5C74199b288CCDdc7f5aa82
```

### Rarity System

| Rarity | Multiplier | Pack Odds | Merge Recipe |
|--------|-----------|-----------|--------------|
| Common | 1x | 70% | 3 Common → Rare |
| Rare | 3x | 25% | 3 Rare → Epic |
| Epic | 5x | 5% | 3 Epic → Legendary |
| Legendary | 10x | 0% (merge only) | - |

**Note:** EpicRare (3) exists in enum for storage but is never created.

### Startup Cards

- **Legendary (5)**: Manus, Lovable, Cursor, Anthropic, (1 more)
- **Epic (3)**: Browser Use, Dedalus Labs, Autumn
- **Rare (5)**: Multifactor, Dome, GrazeMate, Tornyol, (1 more)
- **Common (6)**: Pocket, Caretta, AxionOrbital, Freeport, Ruvo, (1 more)

Total: 19 unique startup cards

## 📊 Scoring System

### How It Works

1. **Daily Scorer** runs every 24 hours (or manually via API)
2. Fetches Twitter engagement for all 19 startups
3. Calculates **base points** per startup (likes + retweets + replies)
4. Applies **rarity multipliers** to each player's cards
5. Updates leaderboard with cumulative scores

### Score Calculation

```javascript
Card Score = Base Points × Rarity Multiplier

Example:
Anthropic gets 1000 Twitter engagements today
- Common card holder: 1000 × 1 = 1,000 points
- Rare card holder:   1000 × 3 = 3,000 points
- Epic card holder:   1000 × 5 = 5,000 points
- Legendary holder:   1000 × 10 = 10,000 points
```

### Important

- `/api/card-scores` returns **already multiplied** data (don't multiply again!)
- `/api/top-startups` returns **base points** (no multiplier)
- Leaderboard shows **cumulative multiplied points**

## 🔐 Security Features

### Authentication

- **Wallet Signature Auth**: Message format `fantasyyc:<address>:<timestamp>`
- **5-minute window** for signature validity
- **Admin API Key** for protected operations
- **HMAC Integrity**: All scores signed with HMAC-SHA256
- **Hash Chain**: Daily scores linked - tampering breaks chain

### Rate Limiting

- Global: 100 requests/minute
- Write operations: 10 requests/minute
- Admin operations: 5 requests/minute

### Middleware

- `auth.js` - Wallet signature verification
- `integrity.js` - HMAC score signing
- `requireAdmin()` - Admin key validation

## 🎨 Frontend Stack

- **React 19** + **TypeScript**
- **Vite** for build tooling
- **Tailwind CSS** (CDN - configured in `index.html` script tag)
- **ethers.js** for blockchain interaction
- **WalletConnect** for wallet integration
- **Lucide React** for icons
- **GSAP** for animations
- **Recharts** for data visualization

### Key Features

- Mobile-responsive (bottom sheet modals, 2-column card grid)
- Auto-refreshing leaderboard (30s polling)
- Real-time live feed (60s polling)
- Blockchain cache (5s tick for contract reads)
- Pixel avatar generation (deterministic from wallet address)

## 🛠️ Development

### Run Daily Scorer Manually

```bash
cd server
npm run score
```

Processes ~19 startups in ~95 seconds (Twitter rate limiting).

### Finalize Tournament

```bash
cd server
npm run finalize
```

Distributes prizes to top players and resets tournament state.

### Database Schema

SQLite database at `server/db/fantasyyc.db` with tables:
- `user_profiles` - Player info (address, username, avatar)
- `daily_scores` - Daily base points per startup
- `score_history` - Player score breakdowns per day
- `live_feed` - Real-time Twitter event feed
- `tournament_state` - Active tournament tracking

Auto-saves every 5 seconds + on server shutdown.

## 📦 Referral System

```javascript
// Single-transaction referral registration
await packOpener.buyAndOpenPack(referrerAddress, {
  value: ethers.parseEther("5")
});
```

- **10% referrer** / **10% platform** / **80% prize pool**
- Auto-registered on first pack purchase
- Existing users protected from being auto-referred

## 🌐 Network Configuration

| Network | Chain ID | RPC | Explorer |
|---------|----------|-----|----------|
| **Shadownet (Testnet)** | 127823 | https://node.shadownet.etherlink.com | https://shadownet.explorer.etherlink.com |
| Mainnet | 42793 | https://node.mainnet.etherlink.com | https://explorer.etherlink.com |

## 📝 Common Issues

### `getUserListings is not a function`

**Fixed!** Contract uses `getListingsBySeller(address)` - updated in [useMarketplaceV2.ts:132](front/hooks/useMarketplaceV2.ts#L132).

### Horizontal scroll on mobile

Add `overflow-x-hidden` to `body` and `main` elements.

### Re-rendering API calls

Check dependencies in `useEffect` - use `useCallback` for stable function references.

## 📚 Additional Documentation

- [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) - Backend/frontend integration details

## 🤝 Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open Pull Request

## 📄 License

MIT License - see LICENSE file for details

## 🔗 Links

- **Live App**: TBD
- **Shadownet Explorer**: https://shadownet.explorer.etherlink.com
- **Faucet**: https://shadownet.faucet.etherlink.com/
- **Etherlink Docs**: https://docs.etherlink.com

---

Built with ❤️ by the UnicornX team
