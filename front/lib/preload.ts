// Preloader: fires all dashboard API calls in parallel on import
// Import this BEFORE App.tsx to start fetching while React is still mounting
//
// Flow:
// 1. Module imported → all fetches fire immediately (parallel)
// 2. React mounts → components check preloaded data → instant render (no spinner)
// 3. Components still poll on their own intervals for updates

import { blockchainCache } from './cache';
import { apiUrl } from './api';
import { useGLTF } from '@react-three/drei';

// ── Preload 3D GLB model ──
const GLB_PATH = '/Meshy_AI_MegaETH_Card_Pack_0213081918_texture.glb';
// 1. Start drei's GLTFLoader cache (so useGLTF() is instant later)
useGLTF.preload(GLB_PATH);
// 2. Also fetch raw bytes into browser HTTP cache — we await this in preloadAll()
//    so splash screen doesn't dismiss until the 5MB GLB is fully downloaded.
const glbPromise = fetch(GLB_PATH).then(r => r.arrayBuffer()).catch(() => {});

// ── Cache keys for preloaded data ──
export const PreloadKeys = {
    activeTournament: 'preload:tournament',
    liveFeed: 'preload:livefeed',
    leaderboard: (id: number) => `preload:leaderboard:${id}`,
    topStartups: (id: number) => `preload:topStartups:${id}`,
};

// ── Preload state ──
let _tournamentId: number | null = null;

/** Get preloaded tournament ID (null if not yet loaded) */
export function getPreloadedTournamentId(): number | null {
    return _tournamentId;
}

/** Reset preload state and re-fetch network-specific data only.
 *  Live feed + images are shared across networks — skip them.
 *  Old cached data stays so components don't flash blank. */
export function resetPreloadState(): void {
    _tournamentId = null;
    preloadNetworkData();
}

// ── Preload all 19 startup images into browser cache ──
function preloadImages(): Promise<void> {
    const STARTUP_COUNT = 19;
    const promises: Promise<void>[] = [];
    for (let i = 1; i <= STARTUP_COUNT; i++) {
        promises.push(new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve();
            img.onerror = () => resolve(); // don't block on error
            img.src = `/images/${i}.png`;
        }));
    }
    return Promise.all(promises).then(() => {});
}

// ── Network-switch preload (tournament + leaderboard only) ──
// Live feed & top startups are shared across networks — skip them.
// Throttled: max once per 30s to avoid 429.
let _lastNetworkPreload = 0;
async function preloadNetworkData() {
    const now = Date.now();
    if (now - _lastNetworkPreload < 30_000) return;
    _lastNetworkPreload = now;

    try {
        const tournamentRes = await fetch(apiUrl('/tournaments/active')).then(r => r.json()).catch(() => null);
        if (tournamentRes?.success) {
            blockchainCache.set(PreloadKeys.activeTournament, tournamentRes.data);
            _tournamentId = tournamentRes.data.id;
        }
        if (_tournamentId) {
            const leaderboardRes = await fetch(apiUrl(`/leaderboard/${_tournamentId}?limit=10`)).then(r => r.json()).catch(() => null);
            if (leaderboardRes?.success) {
                blockchainCache.set(PreloadKeys.leaderboard(_tournamentId), leaderboardRes.data);
            }
        }
    } catch {}
}

// ── Full preload (first load only — includes live feed + images) ──
async function preloadAll() {
    const start = performance.now();

    // Fire image + GLB preloads in parallel with API calls
    const imagePromise = preloadImages();

    try {
        // Phase 1: tournament + live feed + images + GLB in parallel
        const [tournamentRes, feedRes] = await Promise.all([
            fetch(apiUrl('/tournaments/active')).then(r => r.json()).catch(() => null),
            fetch(apiUrl('/live-feed?limit=15')).then(r => r.json()).catch(() => null),
        ]);

        if (tournamentRes?.success) {
            blockchainCache.set(PreloadKeys.activeTournament, tournamentRes.data);
            _tournamentId = tournamentRes.data.id;
        }

        if (feedRes?.success) {
            blockchainCache.set(PreloadKeys.liveFeed, feedRes.data);
        }

        // Phase 2: leaderboard + top startups (need tournament ID)
        if (_tournamentId) {
            const [leaderboardRes, startupsRes] = await Promise.all([
                fetch(apiUrl(`/leaderboard/${_tournamentId}?limit=10`)).then(r => r.json()).catch(() => null),
                fetch(apiUrl(`/top-startups/${_tournamentId}?limit=5`)).then(r => r.json()).catch(() => null),
            ]);

            if (leaderboardRes?.success) {
                blockchainCache.set(PreloadKeys.leaderboard(_tournamentId), leaderboardRes.data);
            }
            if (startupsRes?.success) {
                blockchainCache.set(PreloadKeys.topStartups(_tournamentId), startupsRes.data);
            }
        }

        // Wait for images + GLB to finish (they started in parallel with API calls)
        await Promise.all([imagePromise, glbPromise]);

        const elapsed = (performance.now() - start).toFixed(0);
    } catch (e) {
    }
}

// Fire immediately on module import
export const preloadPromise = preloadAll();
