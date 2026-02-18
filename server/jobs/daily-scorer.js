/**
 * Daily Scorer
 *
 * Two modes:
 * - FULL mode (tournament active): scores startups, calculates player scores, updates leaderboard
 * - FEED-ONLY mode (no tournament): fetches tweets and generates live feed + AI headlines only
 *
 * Steps:
 * 1. Check for active tournament on blockchain
 * 2. Fetch participants from chain (full mode only)
 * 3. Fetch & score tweets for ALL startups → save to live feed (ALWAYS)
 * 4. Calculate player scores from cards × base scores (full mode only)
 * 5. Print leaderboard (full mode only)
 * 6. Print AI scoring summary
 * 7. Generate AI headline summaries for feed events
 *
 * Designed to run daily at 00:00 UTC via server scheduler.
 * Scores the PREVIOUS day (yesterday UTC).
 */

import { ethers } from 'ethers';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as db from '../db/database.js';
import { CHAIN, CONTRACTS } from '../config.js';
import { computeDailyScoreHmac, computeScoreHmac, computeLeaderboardHmac, computeIntegrityHash } from '../middleware/integrity.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import Twitter scorer
const twitterScorerPath = join(__dirname, '../../scripts/twitter-league-scorer.js');
const { processStartupForDate, STARTUP_MAPPING, aiStats, logAI, setLogContext } = await import(`file:///${twitterScorerPath.replace(/\\/g, '/')}`);

// ============ Blockchain config (from server/config.js) ============

const packOpenerABI = [
    'function activeTournamentId() view returns (uint256)'
];

const tournamentABI = [
    'function getTournament(uint256 tournamentId) view returns (tuple(uint256 id, uint256 registrationStart, uint256 startTime, uint256 endTime, uint256 prizePool, uint256 entryCount, uint8 status))',
    'function getTournamentParticipants(uint256 tournamentId) view returns (address[])',
    'function getUserLineup(uint256 tournamentId, address user) view returns (tuple(uint256[5] cardIds, address owner, uint256 timestamp, bool cancelled, bool claimed))',
];

const nftABI = [
    'function getCardInfo(uint256 tokenId) view returns (tuple(uint256 startupId, uint256 edition, uint8 rarity, uint256 multiplier, bool isLocked, string name))',
];

const RARITY_NAMES = ['Common', 'Rare', 'Epic', 'EpicRare', 'Legendary'];

// ============ Blockchain reads ============

function getProvider() {
    return new ethers.JsonRpcProvider(CHAIN.RPC_URL);
}

async function getActiveTournament() {
    const provider = getProvider();
    const packOpener = new ethers.Contract(CONTRACTS.PackOpener, packOpenerABI, provider);
    const tournament = new ethers.Contract(CONTRACTS.TournamentManager, tournamentABI, provider);

    const tournamentId = await packOpener.activeTournamentId();
    if (tournamentId == 0) return null;

    const t = await tournament.getTournament(tournamentId);
    const now = Math.floor(Date.now() / 1000);
    const regStart = Number(t.registrationStart);
    const start = Number(t.startTime);
    const end = Number(t.endTime);

    let status = 'upcoming';
    if (now < regStart) status = 'upcoming';
    else if (now >= regStart && now < start) status = 'registration';
    else if (now >= start && now < end) status = 'active';
    else if (now >= end) status = 'ended';

    return {
        id: Number(tournamentId),
        startTime: start,
        endTime: end,
        registrationStart: regStart,
        prizePool: ethers.formatEther(t.prizePool),
        entryCount: Number(t.entryCount),
        status
    };
}

async function getParticipants(tournamentId) {
    const provider = getProvider();
    const tournament = new ethers.Contract(CONTRACTS.TournamentManager, tournamentABI, provider);
    const participants = await tournament.getTournamentParticipants(tournamentId);
    return participants.map(addr => addr.toLowerCase());
}

async function getPlayerCards(tournamentId, playerAddress) {
    const provider = getProvider();
    const tournament = new ethers.Contract(CONTRACTS.TournamentManager, tournamentABI, provider);
    const nft = new ethers.Contract(CONTRACTS.UnicornX_NFT, nftABI, provider);

    const lineup = await tournament.getUserLineup(tournamentId, playerAddress);
    const cards = [];

    for (const tokenId of lineup.cardIds) {
        if (tokenId == 0) continue;
        const info = await nft.getCardInfo(tokenId);
        cards.push({
            tokenId: Number(tokenId),
            name: info.name,
            rarity: RARITY_NAMES[info.rarity] || 'Common',
            multiplier: Number(info.multiplier)
        });
    }

    return cards;
}

// ============ Scoring logic ============

function calculatePlayerScore(playerCards, startupBaseScores) {
    let totalPoints = 0;
    const breakdown = {};

    for (const card of playerCards) {
        const baseScore = startupBaseScores[card.name] || 0;
        const cardPoints = baseScore * card.multiplier;

        totalPoints += cardPoints;
        breakdown[card.name] = {
            basePoints: baseScore,
            rarity: card.rarity,
            multiplier: card.multiplier,
            totalPoints: cardPoints
        };
    }

    return { totalPoints, breakdown };
}

/**
 * Get yesterday's date string in UTC (YYYY-MM-DD).
 * Since this runs at 00:00 UTC, "yesterday" is the day we're scoring.
 */
function getYesterdayUTC() {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().split('T')[0];
}

// ============ Main scoring function ============

/**
 * Run daily scoring.
 * Always fetches tweets and generates live feed + AI summaries.
 * Only calculates player scores / leaderboard when a tournament is active.
 *
 * @param {string} [dateOverride] - Optional date to score (YYYY-MM-DD). Defaults to yesterday UTC.
 * @param {boolean} [force] - If true, clear old scores/feed for this date and re-score.
 */
async function runDailyScoring(dateOverride, force = false) {
    const scoringDate = dateOverride || getYesterdayUTC();
    console.log(`\n--- Daily Scorer ---`);
    console.log(`Scoring date: ${scoringDate}`);

    // Set log context for this run
    setLogContext(scoringDate);
    aiStats.reset();

    // 1. Check for active tournament (optional — scoring runs either way)
    console.log('\n[1] Fetching active tournament from chain...');
    let tournament = null;
    try {
        tournament = await getActiveTournament();
    } catch (error) {
        console.error('Failed to read tournament from chain:', error.message);
    }

    const hasTournament = tournament && tournament.status === 'active';

    if (hasTournament) {
        console.log(`Tournament #${tournament.id} | status=${tournament.status} | players=${tournament.entryCount} | pool=${tournament.prizePool} XTZ`);
        db.saveTournament(tournament);

        // Check if this date was already scored (prevent double scoring)
        const existingScores = db.getDailyScores(tournament.id, scoringDate);
        if (existingScores.length > 0) {
            if (force) {
                console.log(`[FORCE] Clearing old scores and feed for ${scoringDate}...`);
                db.clearDailyScoresForDate(tournament.id, scoringDate);
                db.clearLiveFeedForDate(scoringDate);
            } else {
                console.log(`Date ${scoringDate} already has ${existingScores.length} startup scores for tournament #${tournament.id}. Skipping to avoid duplicates.`);
                return;
            }
        }
    } else {
        console.log(tournament
            ? `Tournament #${tournament.id} status is "${tournament.status}". Running in feed-only mode (no player scoring).`
            : 'No active tournament. Running in feed-only mode (no player scoring).'
        );

        // In feed-only mode, still check for duplicate feed entries
        if (force) {
            db.clearLiveFeedForDate(scoringDate);
        }
    }

    // 2. Get participants (only if tournament active)
    let participants = [];
    if (hasTournament) {
        console.log('\n[2] Fetching participants from chain...');
        try {
            participants = await getParticipants(tournament.id);
        } catch (error) {
            console.error('Failed to read participants:', error.message);
        }
        console.log(`Found ${participants.length} participants`);

        for (const p of participants) {
            db.saveTournamentEntry(tournament.id, p);
        }
    }

    // 3. Fetch & score tweets for all startups (ALWAYS runs)
    console.log('\n[3] Scoring startups from Twitter...');
    const startupBaseScores = {};
    const handles = Object.keys(STARTUP_MAPPING);

    for (let i = 0; i < handles.length; i++) {
        const handle = handles[i];
        const name = STARTUP_MAPPING[handle];
        console.log(`\n  [${i + 1}/${handles.length}] @${handle} (${name})`);

        try {
            const result = await processStartupForDate(handle, scoringDate);
            startupBaseScores[name] = result.totalPoints;

            console.log(`  -> ${result.tweetCount} tweets, ${result.totalPoints} pts`);

            // Save daily score with HMAC (only if tournament active)
            if (hasTournament) {
                const dailyHmac = computeDailyScoreHmac({
                    tournamentId: tournament.id,
                    startupName: name,
                    date: scoringDate,
                    basePoints: result.totalPoints,
                    tweetsAnalyzed: result.tweetCount
                });
                db.saveDailyScore(
                    tournament.id,
                    name,
                    scoringDate,
                    result.totalPoints,
                    result.tweetCount,
                    result.tweets.flatMap(t => t.events),
                    dailyHmac
                );
            }

            // Save to live feed — one entry per tweet (ALWAYS)
            for (const tweet of result.tweets) {
                const events = tweet.events || [];
                if (events.length === 0) continue;
                const primary = events[0] || { type: 'ENGAGEMENT', score: 0 };
                db.saveLiveFeedEvent(
                    name,
                    primary.type,
                    tweet.text ? tweet.text.substring(0, 200) : `${name}: ${primary.type}`,
                    tweet.points || primary.score || 0,
                    tweet.id || null,
                    scoringDate,
                    tweet.headline || null
                );
            }
        } catch (error) {
            console.error(`  Error scoring ${name}: ${error.message}`);
            startupBaseScores[name] = 0;
        }

        // Rate limit between startups
        if (i < handles.length - 1) {
            await new Promise(r => setTimeout(r, 5000));
        }
    }

    // 3b. Build integrity hash chain (only if tournament active)
    if (hasTournament) {
        try {
            const scoresJson = JSON.stringify(
                Object.entries(startupBaseScores).sort(([a], [b]) => a.localeCompare(b))
            );
            const previousHash = db.getLatestIntegrityHash(tournament.id);
            const integrityHash = computeIntegrityHash(tournament.id, scoringDate, scoresJson, previousHash);
            db.setConfig(`integrity_latest_${tournament.id}`, JSON.stringify({
                hash: integrityHash,
                previousHash: previousHash || 'GENESIS',
                date: scoringDate
            }));
            console.log(`  Integrity chain: ${integrityHash.substring(0, 16)}...`);
        } catch (e) {
            console.error('  Integrity hash error:', e.message);
        }
    }

    // 4. Calculate player scores (only if tournament active)
    if (hasTournament && participants.length > 0) {
        console.log('\n[4] Calculating player scores...');

        for (const participant of participants) {
            try {
                const cards = await getPlayerCards(tournament.id, participant);

                if (cards.length === 0) {
                    console.log(`  ${participant.substring(0, 10)}... - no cards, skipping`);
                    continue;
                }

                db.savePlayerCards(tournament.id, participant, cards);

                const { totalPoints, breakdown } = calculatePlayerScore(cards, startupBaseScores);

                const scoreHmac = computeScoreHmac({
                    tournamentId: tournament.id,
                    playerAddress: participant,
                    date: scoringDate,
                    points: totalPoints,
                    breakdown
                });
                db.saveScoreHistory(tournament.id, participant, scoringDate, totalPoints, breakdown, scoreHmac);

                const history = db.getPlayerScoreHistory(tournament.id, participant);
                const totalScore = history.reduce((sum, h) => sum + h.points_earned, 0);

                const leaderboardHmac = computeLeaderboardHmac({
                    tournamentId: tournament.id,
                    playerAddress: participant,
                    totalScore
                });
                db.updateLeaderboard(tournament.id, participant, totalScore, leaderboardHmac);

                console.log(`  ${participant.substring(0, 10)}... - today: ${totalPoints.toFixed(1)} | total: ${totalScore.toFixed(1)}`);
            } catch (error) {
                console.error(`  Error for ${participant.substring(0, 10)}...: ${error.message}`);
            }
        }

        // 5. Print leaderboard
        const leaderboard = db.getLeaderboard(tournament.id, 10);
        if (leaderboard.length > 0) {
            console.log('\n[5] Leaderboard:');
            leaderboard.forEach((entry, i) => {
                console.log(`  ${i + 1}. ${entry.address.substring(0, 10)}... - ${entry.score.toFixed(1)} pts`);
            });
        }
    }

    // 6. Print AI scoring summary
    console.log('\n[6] AI Scoring Summary:');
    console.log(`  Startups scored: ${aiStats.totalStartups}`);
    console.log(`  AI success: ${aiStats.aiSuccessStartups} | Keyword fallback: ${aiStats.keywordFallbackStartups}`);
    console.log(`  Tweets total: ${aiStats.totalTweetsAnalyzed} | AI: ${aiStats.aiScoredTweets} | Keywords: ${aiStats.keywordScoredTweets}`);
    if (Object.keys(aiStats.modelAttempts).length > 0) {
        console.log('  Model breakdown:');
        for (const [model, stats] of Object.entries(aiStats.modelAttempts)) {
            console.log(`    ${model}: tried=${stats.tried} ok=${stats.succeeded} fail=${stats.failed}`);
        }
    }
    if (aiStats.errors.length > 0) {
        console.log(`  Errors (${aiStats.errors.length}):`);
        for (const e of aiStats.errors.slice(0, 5)) {
            console.log(`    ${e.startup} / ${e.model}: ${e.error}`);
        }
    }

    logAI({
        type: 'scoring_run_summary',
        date: scoringDate,
        tournamentId: hasTournament ? tournament.id : null,
        mode: hasTournament ? 'full' : 'feed-only',
        totalStartups: aiStats.totalStartups,
        aiSuccessStartups: aiStats.aiSuccessStartups,
        keywordFallbackStartups: aiStats.keywordFallbackStartups,
        totalTweets: aiStats.totalTweetsAnalyzed,
        aiScoredTweets: aiStats.aiScoredTweets,
        keywordScoredTweets: aiStats.keywordScoredTweets,
        modelAttempts: aiStats.modelAttempts,
        errors: aiStats.errors
    });

    aiStats.reset();

    // 7. Generate AI summaries for any unsummarized feed events
    console.log('\n[7] Generating AI feed summaries...');
    try {
        const { summarizeFeedEvents, setSummarizerContext } = await import('../services/ai-summarizer.js');
        setSummarizerContext(scoringDate);
        let summarized = 0;
        while (true) {
            const unsummarized = db.getUnsummarizedFeedEvents(20);
            if (unsummarized.length === 0) break;
            const results = await summarizeFeedEvents(unsummarized);
            db.batchUpdateFeedSummaries(results);
            summarized += results.length;
        }
        console.log(`  ${summarized} summaries generated`);
    } catch (e) {
        console.error('  Summarizer error:', e.message);
    }

    // Save to disk
    db.saveDatabase();
    console.log(`\nScoring complete (${hasTournament ? 'full' : 'feed-only'} mode). DB saved.`);
}

export { runDailyScoring };
