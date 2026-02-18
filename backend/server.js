// UnicornX Metadata API Server
// Serves dynamic NFT metadata for OpenSea and other marketplaces

const express = require("express");
const cors = require("cors");
const path = require("path");
const { ethers } = require("ethers");
require("dotenv").config({ path: path.join(__dirname, ".env"), override: false });

const app = express();
const PORT = process.env.PORT || 3006;

// Server URL for images (use env or localhost for dev)
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;

// ============ Configuration ============

// Contract address (update after deployment)
const NFT_CONTRACT_ADDRESS = process.env.NFT_CONTRACT_ADDRESS || "0x0000000000000000000000000000000000000000";

// RPC endpoint
const RPC_URL = process.env.RPC_URL || "https://testnet.riselabs.xyz";

// IPFS base URL for images (19 startup images)
const IPFS_IMAGE_BASE = process.env.IPFS_IMAGE_BASE || "ipfs://QmIMAGEPLACEHOLDER";

// ============ Startup Data ============

const STARTUPS = {
    // Legendary (10x multiplier)
    1: {
        name: "Openclaw",
        slug: "openclaw",
        rarity: "Legendary",
        multiplier: 10,
        description: "AI-powered autonomous coding agent"
    },
    2: {
        name: "Lovable",
        slug: "lovable",
        rarity: "Legendary",
        multiplier: 10,
        description: "AI software engineer",
        fundraising: { round: "Series B", amount: "$330M", valuation: "$6.6B" }
    },
    3: {
        name: "Cursor",
        slug: "cursor",
        rarity: "Legendary",
        multiplier: 10,
        description: "AI-first code editor",
        fundraising: { round: "Series D", amount: "$2.3B", valuation: "$29.3B" }
    },
    4: {
        name: "OpenAI",
        slug: "openai",
        rarity: "Legendary",
        multiplier: 10,
        description: "Leading AI research lab - GPT",
        fundraising: { round: "Series F", amount: "$30B", valuation: null }
    },
    5: {
        name: "Anthropic",
        slug: "anthropic",
        rarity: "Legendary",
        multiplier: 10,
        description: "AI safety company - Claude",
        fundraising: { round: "Series F", amount: "$13B", valuation: "$183B" }
    },

    // Epic (5x multiplier)
    6: {
        name: "Browser Use",
        slug: "browser-use",
        rarity: "Epic",
        multiplier: 5,
        description: "AI browser autortion",
        fundraising: { round: "Seed", amount: "$17M", valuation: null }
    },
    7: {
        name: "Dedalus Labs",
        slug: "dedalus-labs",
        rarity: "Epic",
        multiplier: 5,
        description: "Decentralized infrastructure",
        fundraising: { round: "Seed", amount: "$11M", valuation: null }
    },
    8: {
        name: "Autumn",
        slug: "autumn",
        rarity: "Epic",
        multiplier: 5,
        description: "Insurance automation"
    },

    // Rare (3x multiplier)
    9: {
        name: "Axiom",
        slug: "axiom",
        rarity: "Rare",
        multiplier: 3,
        description: "ZK coprocessor for Ethereum"
    },
    10: {
        name: "Multifactor",
        slug: "multifactor",
        rarity: "Rare",
        multiplier: 3,
        description: "Authentication platform",
        fundraising: { round: "Seed", amount: "$15M", valuation: null }
    },
    11: {
        name: "Dome",
        slug: "dome",
        rarity: "Rare",
        multiplier: 3,
        description: "Smart home security",
        fundraising: { round: "Pre-seed", amount: "$500K", valuation: null }
    },
    12: {
        name: "GrazeMate",
        slug: "grazemate",
        rarity: "Rare",
        multiplier: 3,
        description: "AgTech for livestock",
        fundraising: { round: "Seed", amount: "$1.2M", valuation: null }
    },
    13: {
        name: "Tornyol Systems",
        slug: "tornyol-systems",
        rarity: "Rare",
        multiplier: 3,
        description: "Industrial automation",
        fundraising: { round: "Seed", amount: "$4M", valuation: null }
    },

    // Common (1x multiplier)
    14: {
        name: "Pocket",
        slug: "pocket",
        rarity: "Common",
        multiplier: 1,
        description: "Mobile savings app",
        fundraising: { round: "Seed", amount: "$500K", valuation: null }
    },
    15: {
        name: "Caretta",
        slug: "caretta",
        rarity: "Common",
        multiplier: 1,
        description: "Fleet management",
        fundraising: { round: "Seed", amount: "$1.3M", valuation: null }
    },
    16: {
        name: "AxionOrbital Space",
        slug: "axionorbital-space",
        rarity: "Common",
        multiplier: 1,
        description: "Space logistics",
        fundraising: { round: "Seed", amount: "$500K", valuation: null }
    },
    17: {
        name: "Freeport Markets",
        slug: "freeport-markets",
        rarity: "Common",
        multiplier: 1,
        description: "DeFi marketplace",
        fundraising: { round: "Pre-seed", amount: "$1.1M", valuation: null }
    },
    18: {
        name: "Ruvo",
        slug: "ruvo",
        rarity: "Common",
        multiplier: 1,
        description: "Sustainable packaging",
        fundraising: { round: "Seed", amount: "$4.6M", valuation: null }
    },
    19: {
        name: "Lightberry",
        slug: "lightberry",
        rarity: "Common",
        multiplier: 1,
        description: "Energy management platform",
        fundraising: { round: "Seed", amount: "$500K", valuation: null }
    },
};

// ============ Dynamic Stats (simulated - would come from Grok API/DB) ============

const DYNAMIC_STATS = {
    1: { valuation: "Stealth", partnerships: 2, funding: "Stealth Mode" },
    2: { valuation: "$6.6B", partnerships: 15, funding: "$330M Series B" },
    3: { valuation: "$29.3B", partnerships: 25, funding: "$2.3B Series D" },
    4: { valuation: "Est. $300B+", partnerships: 100, funding: "$30B Series F" },
    5: { valuation: "$183B", partnerships: 50, funding: "$13B Series F" },
    6: { valuation: "Est. $100M", partnerships: 5, funding: "$17M Seed" },
    7: { valuation: "Est. $80M", partnerships: 4, funding: "$11M Seed" },
    8: { valuation: "Stealth", partnerships: 2, funding: "Stealth Mode" },
    9: { valuation: "Stealth", partnerships: 3, funding: "Stealth Mode" },
    10: { valuation: "Est. $120M", partnerships: 8, funding: "$15M Seed" },
    11: { valuation: "Est. $5M", partnerships: 2, funding: "$500K Pre-seed" },
    12: { valuation: "Est. $10M", partnerships: 3, funding: "$1.2M Seed" },
    13: { valuation: "Est. $30M", partnerships: 4, funding: "$4M Seed" },
    14: { valuation: "Est. $5M", partnerships: 2, funding: "$500K Seed" },
    15: { valuation: "Est. $12M", partnerships: 3, funding: "$1.3M Seed" },
    16: { valuation: "Est. $5M", partnerships: 2, funding: "$500K Seed" },
    17: { valuation: "Est. $10M", partnerships: 3, funding: "$1.1M Pre-seed" },
    18: { valuation: "Est. $40M", partnerships: 5, funding: "$4.6M Seed" },
    19: { valuation: "Est. $5M", partnerships: 2, funding: "$500K Seed" },
};

// ============ Contract ABI (minimal for reading) ============

const NFT_ABI = [
    "function tokenToStartup(uint256 tokenId) view returns (uint256)",
    "function tokenToEdition(uint256 tokenId) view returns (uint256)",
    "function startupMintCount(uint256 startupId) view returns (uint256)",
    "function isLocked(uint256 tokenId) view returns (bool)",
    "function ownerOf(uint256 tokenId) view returns (address)",
    "function totalSupply() view returns (uint256)",
    "function getCardInfo(uint256 tokenId) view returns (tuple(uint256 startupId, uint256 edition, uint8 rarity, uint256 multiplier, bool isLocked, string name))"
];

// ============ Provider & Contract ============

let provider = null;
let nftContract = null;

function initContract() {
    try {
        provider = new ethers.JsonRpcProvider(RPC_URL);
        if (NFT_CONTRACT_ADDRESS !== "0x0000000000000000000000000000000000000000") {
            nftContract = new ethers.Contract(NFT_CONTRACT_ADDRESS, NFT_ABI, provider);
            console.log("✅ Connected to NFT contract:", NFT_CONTRACT_ADDRESS);
        } else {
            console.log("⚠️  No contract address set - using mock data for testing");
        }
    } catch (error) {
        console.error("❌ Failed to connect to RPC:", error.message);
    }
}

// ============ Middleware ============

app.use(cors());
app.use(express.json());

// Serve static files (images) — both direct and via nginx /metadata/ proxy
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));
app.use('/metadata/images', express.static(path.join(__dirname, 'public', 'images')));

// Request logging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
    next();
});

// ============ Mock Data for Testing ============

// Simulates contract data before deployment
const MOCK_TOKENS = {};

function generateMockToken(tokenId) {
    // Simulate random distribution like the pack opener
    const seed = tokenId * 12345;
    const rarityRoll = seed % 100;

    let startupId;
    if (rarityRoll < 70) {
        // Common: IDs 14-19 (6 startups)
        startupId = 14 + (seed % 6);
    } else if (rarityRoll < 95) {
        // Rare: IDs 9-13 (5 startups)
        startupId = 9 + ((seed / 100) % 5);
    } else {
        // Epic: IDs 6-8 (3 startups) — Legendary only from merging
        startupId = 6 + ((seed / 1000) % 3);
    }

    // Calculate edition based on how many of this startup we've "seen"
    const edition = Math.floor(tokenId / 19) + 1;

    return {
        startupId,
        edition,
        isLocked: false,
        totalMinted: edition * 3 // Simulated total
    };
}

// ============ Token Cache ============

// In-memory cache for token data (avoids repeated blockchain queries)
const tokenCache = new Map();
const CACHE_TTL = 60 * 60 * 1000;      // 1 hour for valid tokens (card data is immutable after mint)
const CACHE_TTL_NOT_FOUND = 30 * 1000; // 30 seconds for not-found (RPC lag recovery)

function getCachedToken(tokenId) {
    const cached = tokenCache.get(tokenId);
    if (!cached) return null;

    const ttl = cached.data.nonExistent ? CACHE_TTL_NOT_FOUND : CACHE_TTL;
    if (Date.now() - cached.timestamp < ttl) {
        return cached.data;
    }
    return null;
}

function setCachedToken(tokenId, data) {
    tokenCache.set(tokenId, {
        data,
        timestamp: Date.now()
    });
}

// ============ Shared Helpers ============

const RARITY_NAMES = ['Common', 'Rare', 'Epic', 'EpicRare', 'Legendary'];

/**
 * Fetch token data from cache or blockchain.
 * Returns { error } on failure, or token fields on success.
 */
async function fetchTokenData(tokenId) {
    // Check cache first
    const cached = getCachedToken(tokenId);
    if (cached) {
        if (cached.nonExistent) {
            return { error: "Token does not exist or has been burned" };
        }
        return cached;
    }

    if (nftContract) {
        try {
            let startupId, edition, isLocked, contractRarity = null, contractMultiplier = null;
            try {
                // Single RPC call — getCardInfo returns all needed data
                const cardInfo = await nftContract.getCardInfo(tokenId);
                startupId = Number(cardInfo.startupId);
                edition = Number(cardInfo.edition);
                isLocked = cardInfo.isLocked;
                contractRarity = Number(cardInfo.rarity);
                contractMultiplier = Number(cardInfo.multiplier);
            } catch (cardInfoError) {
                // Fallback for older contracts without getCardInfo
                startupId = Number(await nftContract.tokenToStartup(tokenId));
                edition = Number(await nftContract.tokenToEdition(tokenId));
                isLocked = await nftContract.isLocked(tokenId);
            }

            if (startupId === 0) {
                setCachedToken(tokenId, { startupId: 0, nonExistent: true });
                return { error: "Token does not exist or has been burned" };
            }

            const data = { startupId, edition, isLocked, totalMinted: edition, contractRarity, contractMultiplier };
            setCachedToken(tokenId, data);
            return data;
        } catch (contractError) {
            setCachedToken(tokenId, { startupId: 0, nonExistent: true });
            return { error: "Token does not exist or has been burned" };
        }
    } else {
        const mock = generateMockToken(tokenId);
        return { startupId: mock.startupId, edition: mock.edition, isLocked: mock.isLocked, totalMinted: mock.totalMinted, contractRarity: null, contractMultiplier: null };
    }
}

/**
 * Build OpenSea-compatible metadata object from token data.
 */
function buildMetadata(tokenId, tokenData) {
    const { startupId, edition, isLocked, totalMinted, contractRarity, contractMultiplier } = tokenData;

    const startup = STARTUPS[startupId];
    if (!startup) return { error: "Startup not found" };

    const effectiveRarity = (contractRarity !== null && contractRarity >= 0 && contractRarity <= 4)
        ? RARITY_NAMES[contractRarity]
        : startup.rarity;
    const effectiveMultiplier = (contractMultiplier !== null && contractMultiplier > 0)
        ? contractMultiplier
        : startup.multiplier;

    const stats = DYNAMIC_STATS[startupId] || {};

    const imageUrl = IPFS_IMAGE_BASE.startsWith("ipfs://") && !IPFS_IMAGE_BASE.includes("PLACEHOLDER")
        ? `${IPFS_IMAGE_BASE}/${startupId}.png`
        : `${SERVER_URL}/images/${startupId}.png`;

    return {
        name: `${startup.name} #${edition}`,
        description: `${effectiveRarity} YC startup card - ${startup.description}. Edition ${edition} of ${totalMinted} minted.`,
        image: imageUrl,
        external_url: `https://unicornx.app/card/${tokenId}`,
        fundraising: startup.fundraising || null,
        attributes: [
            { trait_type: "Startup", value: startup.name },
            { trait_type: "Startup ID", value: startupId.toString() },
            { trait_type: "Rarity", value: effectiveRarity },
            { trait_type: "Multiplier", value: effectiveMultiplier.toString() + "x" },
            { trait_type: "Edition", value: edition.toString(), display_type: "number" },
            { trait_type: "Total Minted", value: totalMinted, display_type: "number" },
            { trait_type: "Locked", value: isLocked ? "Yes" : "No" },
            { trait_type: "Valuation", value: stats.valuation || "N/A" },
            { trait_type: "Partnerships", value: stats.partnerships || 0, display_type: "number" },
            { trait_type: "Funding", value: stats.funding || "N/A" },
            { trait_type: "Last Updated", value: new Date().toISOString().split("T")[0] }
        ]
    };
}

// ============ API Routes ============

/**
 * Health check
 */
app.get("/", (req, res) => {
    res.json({
        name: "UnicornX Metadata API",
        version: "1.0.0",
        status: "running",
        contract: NFT_CONTRACT_ADDRESS,
        network: "RISE Testnet",
        cacheSize: tokenCache.size
    });
});

/**
 * Batch metadata: fetch multiple tokens in one request
 * GET /metadata/batch?tokenIds=1,2,3,4,5
 * Returns { tokens: { "1": {...}, "2": {...} }, errors: { "999": "not found" } }
 * IMPORTANT: must be registered BEFORE /metadata/:tokenId to avoid matching "batch" as tokenId
 */
app.get("/metadata/batch", async (req, res) => {
    try {
        const idsParam = req.query.tokenIds;
        if (!idsParam) {
            return res.status(400).json({ error: "tokenIds query parameter required" });
        }

        const tokenIds = idsParam.split(",").map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n > 0);
        if (tokenIds.length === 0) {
            return res.status(400).json({ error: "No valid token IDs provided" });
        }
        if (tokenIds.length > 50) {
            return res.status(400).json({ error: "Max 50 tokens per batch request" });
        }

        // Fetch all tokens in parallel
        const results = await Promise.all(
            tokenIds.map(async (tokenId) => {
                const tokenData = await fetchTokenData(tokenId);
                if (tokenData.error) {
                    return { tokenId, error: tokenData.error };
                }
                const metadata = buildMetadata(tokenId, tokenData);
                if (metadata.error) {
                    return { tokenId, error: metadata.error };
                }
                return { tokenId, metadata };
            })
        );

        const tokens = {};
        const errors = {};
        for (const r of results) {
            if (r.error) {
                errors[r.tokenId] = r.error;
            } else {
                tokens[r.tokenId] = r.metadata;
            }
        }

        res.set("Cache-Control", "public, max-age=3600");
        res.json({ tokens, errors });
    } catch (error) {
        console.error("Error in batch metadata:", error);
        res.status(500).json({ error: "Failed to fetch batch metadata" });
    }
});

/**
 * Get metadata for a specific token
 * OpenSea and marketplaces call this endpoint
 */
app.get("/metadata/:tokenId", async (req, res) => {
    try {
        const tokenId = parseInt(req.params.tokenId);
        if (isNaN(tokenId) || tokenId < 1) {
            return res.status(400).json({ error: "Invalid token ID" });
        }

        const tokenData = await fetchTokenData(tokenId);
        if (tokenData.error) {
            return res.status(404).json({ error: tokenData.error });
        }

        const metadata = buildMetadata(tokenId, tokenData);
        if (metadata.error) {
            return res.status(404).json({ error: metadata.error });
        }

        res.set("Cache-Control", "public, max-age=3600");
        res.json(metadata);
    } catch (error) {
        console.error("Error generating metadata:", error);
        res.status(500).json({ error: "Failed to generate metadata" });
    }
});

/**
 * Get all startup information
 */
app.get("/startups", (req, res) => {
    res.json(STARTUPS);
});

/**
 * Get specific startup info
 */
app.get("/startups/:id", (req, res) => {
    const id = parseInt(req.params.id);
    const startup = STARTUPS[id];

    if (!startup) {
        return res.status(404).json({ error: "Startup not found" });
    }

    res.json({
        ...startup,
        id,
        stats: DYNAMIC_STATS[id] || {}
    });
});

/**
 * Get contract stats
 */
app.get("/stats", async (req, res) => {
    try {
        let totalSupply = 0;

        if (nftContract) {
            try {
                totalSupply = Number(await nftContract.totalSupply());
            } catch (e) {
                totalSupply = 0;
            }
        }

        res.json({
            totalSupply,
            maxSupply: 10000,
            totalStartups: 19,
            contractAddress: NFT_CONTRACT_ADDRESS,
            network: "RISE Testnet"
        });
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch stats" });
    }
});

// ============ Pre-warm Cache ============

async function prewarmCache() {
    if (!nftContract) {
        console.log("⚠️  Skipping cache pre-warm (no contract)");
        return;
    }

    try {
        const totalSupply = Number(await nftContract.totalSupply());
        if (totalSupply === 0) {
            console.log("📦 No tokens minted yet, nothing to pre-warm");
            return;
        }

        console.log(`🔥 Pre-warming cache for ${totalSupply} tokens...`);
        const startTime = Date.now();

        // Fetch in batches of 20 to avoid overwhelming the RPC
        const BATCH_SIZE = 20;
        let cached = 0;
        let errors = 0;

        for (let i = 1; i <= totalSupply; i += BATCH_SIZE) {
            const batch = [];
            for (let j = i; j < Math.min(i + BATCH_SIZE, totalSupply + 1); j++) {
                batch.push(j);
            }

            const results = await Promise.all(
                batch.map(tokenId => fetchTokenData(tokenId).catch(() => ({ error: true })))
            );

            for (const r of results) {
                if (r.error) errors++;
                else cached++;
            }
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`✅ Pre-warm complete: ${cached} tokens cached, ${errors} errors (${elapsed}s)`);
    } catch (err) {
        console.error("❌ Pre-warm failed:", err.message);
    }
}

// ============ Start Server ============

initContract();

app.listen(PORT, () => {
    console.log("");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("🚀 UnicornX Metadata API Server");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("");
    console.log(`📍 Server running at: http://localhost:${PORT}`);
    console.log("");
    console.log("📋 Endpoints:");
    console.log(`   GET http://localhost:${PORT}/                  - Health check`);
    console.log(`   GET http://localhost:${PORT}/metadata/:tokenId - Token metadata`);
    console.log(`   GET http://localhost:${PORT}/startups          - All startups`);
    console.log(`   GET http://localhost:${PORT}/startups/:id      - Startup by ID`);
    console.log(`   GET http://localhost:${PORT}/stats             - Contract stats`);
    console.log("");
    console.log("🧪 Test URLs:");
    console.log(`   http://localhost:${PORT}/metadata/1`);
    console.log(`   http://localhost:${PORT}/metadata/100`);
    console.log(`   http://localhost:${PORT}/metadata/3421`);
    console.log("");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("");

    // Pre-warm cache in background (non-blocking)
    prewarmCache();
});
