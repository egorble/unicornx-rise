// Centralized cache service for blockchain data
// Cache first, update in background, refresh on changes
// With subscription-based polling for real-time updates

import { getActiveNetworkId } from './networks';

type CacheEntry<T> = {
    data: T;
    timestamp: number;
    key: string;
};

type Subscription = {
    key: string;
    fetcher: () => Promise<any>;
    interval: number;
    callbacks: Set<(data: any) => void>;
};

// Safe comparison that handles BigInt values
function deepEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (typeof a !== typeof b) return false;

    // Handle BigInt
    if (typeof a === 'bigint' && typeof b === 'bigint') {
        return a === b;
    }

    // Handle arrays
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        return a.every((item, index) => deepEqual(item, b[index]));
    }

    // Handle objects
    if (typeof a === 'object' && typeof b === 'object') {
        const keysA = Object.keys(a);
        const keysB = Object.keys(b);
        if (keysA.length !== keysB.length) return false;
        return keysA.every(key => deepEqual(a[key], b[key]));
    }

    return false;
}

// Default TTL: 30 seconds for frequently changing data
const DEFAULT_TTL = 30 * 1000;
// Long TTL: 5 minutes for rarely changing data
const LONG_TTL = 5 * 60 * 1000;

// Polling intervals
const POLLING_INTERVALS = {
    FAST: 10 * 1000,      // 10s - for balances
    NORMAL: 30 * 1000,    // 30s - for NFTs, marketplace
    SLOW: 60 * 1000,      // 60s - for tournaments
    RARE: 5 * 60 * 1000,  // 5min - for pack prices
};

class BlockchainCache {
    private cache = new Map<string, CacheEntry<any>>();
    private pendingRequests = new Map<string, Promise<any>>();
    private subscriptions = new Map<string, Subscription>();
    private pollingIntervalId: NodeJS.Timeout | null = null;
    private isPolling = false;

    // Get cached data immediately, optionally fetch fresh in background
    get<T>(key: string): T | undefined {
        const entry = this.cache.get(key);
        return entry?.data;
    }

    // Check if cache is stale
    isStale(key: string, ttl: number = DEFAULT_TTL): boolean {
        const entry = this.cache.get(key);
        if (!entry) return true;
        return Date.now() - entry.timestamp > ttl;
    }

    // Set cache value
    set<T>(key: string, data: T): void {
        this.cache.set(key, {
            data,
            timestamp: Date.now(),
            key
        });
    }

    // Invalidate specific cache key
    invalidate(key: string): void {
        this.cache.delete(key);
    }

    // Invalidate all keys starting with prefix
    invalidatePrefix(prefix: string): void {
        for (const key of this.cache.keys()) {
            if (key.startsWith(prefix)) {
                this.cache.delete(key);
            }
        }
    }

    // Clear all cache
    clear(): void {
        this.cache.clear();
    }

    // Full reset: clear cache, pending requests, subscriptions, polling
    fullReset(): void {
        this.cache.clear();
        this.pendingRequests.clear();
        this.stopPolling();
        this.subscriptions.clear();
    }

    // Soft reset: stop polling/subscriptions but KEEP cached data
    // Used on network switch so UI shows stale data instead of blank flicker
    softReset(): void {
        this.pendingRequests.clear();
        this.stopPolling();
        this.subscriptions.clear();
    }

    // Get or fetch with deduplication - prevents multiple simultaneous requests for same data
    async getOrFetch<T>(
        key: string,
        fetcher: () => Promise<T>,
        ttl: number = DEFAULT_TTL
    ): Promise<T> {
        // Return cached if fresh enough
        const cached = this.get<T>(key);
        if (cached !== undefined && !this.isStale(key, ttl)) {
            return cached;
        }

        // Check if there's already a pending request for this key
        const pending = this.pendingRequests.get(key);
        if (pending) {
            return pending;
        }

        // Create new request
        const request = fetcher()
            .then(data => {
                this.set(key, data);
                this.pendingRequests.delete(key);
                return data;
            })
            .catch(err => {
                this.pendingRequests.delete(key);
                // Return cached data on error if available
                const fallback = this.get<T>(key);
                if (fallback !== undefined) {
                    return fallback;
                }
                throw err;
            });

        this.pendingRequests.set(key, request);
        return request;
    }

    // Fetch in background and update cache without blocking
    fetchInBackground<T>(key: string, fetcher: () => Promise<T>): void {
        // Don't create duplicate requests
        if (this.pendingRequests.has(key)) return;

        const request = fetcher()
            .then(data => {
                this.set(key, data);
                this.pendingRequests.delete(key);
            })
            .catch(err => {
                this.pendingRequests.delete(key);
            });

        this.pendingRequests.set(key, request);
    }

    // Subscribe to a cache key - returns unsubscribe function
    subscribe<T>(
        key: string,
        fetcher: () => Promise<T>,
        callback: (data: T) => void,
        interval: number = POLLING_INTERVALS.NORMAL
    ): () => void {
        let subscription = this.subscriptions.get(key);

        if (!subscription) {
            subscription = {
                key,
                fetcher,
                interval,
                callbacks: new Set()
            };
            this.subscriptions.set(key, subscription);
        }

        subscription.callbacks.add(callback);

        // Immediately provide cached data if available
        const cached = this.get<T>(key);
        if (cached !== undefined) {
            callback(cached);
        }

        // Start polling if not already running
        this.startPolling();

        // Return unsubscribe function
        return () => {
            subscription!.callbacks.delete(callback);
            if (subscription!.callbacks.size === 0) {
                this.subscriptions.delete(key);
                // Stop polling if no more subscriptions
                if (this.subscriptions.size === 0) {
                    this.stopPolling();
                }
            }
        };
    }

    // Start the polling loop
    private startPolling(): void {
        if (this.isPolling) return;
        this.isPolling = true;

        // Main polling loop - checks every 5 seconds what needs to be refreshed
        const pollTick = async () => {
            const now = Date.now();

            for (const [key, sub] of this.subscriptions) {
                const entry = this.cache.get(key);
                const lastUpdate = entry?.timestamp || 0;

                // Check if this key needs refresh
                if (now - lastUpdate >= sub.interval) {
                    // Fetch in background without blocking
                    if (!this.pendingRequests.has(key)) {
                        const request = sub.fetcher()
                            .then(data => {
                                const oldData = this.get(key);
                                this.set(key, data);
                                this.pendingRequests.delete(key);

                                // Notify subscribers only if data changed (using safe comparison)
                                const hasChanged = !deepEqual(oldData, data);
                                if (hasChanged || oldData === undefined) {
                                    sub.callbacks.forEach(cb => cb(data));
                                }
                            })
                            .catch(err => {
                                this.pendingRequests.delete(key);
                            });

                        this.pendingRequests.set(key, request);
                    }
                }
            }
        };

        // Run immediately, then every 5 seconds
        pollTick();
        this.pollingIntervalId = setInterval(pollTick, 5000);
    }

    // Stop polling
    stopPolling(): void {
        if (this.pollingIntervalId) {
            clearInterval(this.pollingIntervalId);
            this.pollingIntervalId = null;
        }
        this.isPolling = false;
    }

    // Force refresh a specific key
    async refresh<T>(key: string): Promise<T | undefined> {
        const sub = this.subscriptions.get(key);
        if (!sub) return this.get<T>(key);

        try {
            const data = await sub.fetcher();
            this.set(key, data);
            sub.callbacks.forEach(cb => cb(data));
            return data;
        } catch (err) {
            return this.get<T>(key);
        }
    }

    // ── LocalStorage persistence ──

    // Persist cache entries matching prefix to localStorage (namespaced by network)
    persistKeys(prefix: string): void {
        const netId = getActiveNetworkId();
        const toSave: Record<string, CacheEntry<any>> = {};
        for (const [key, entry] of this.cache) {
            if (key.startsWith(prefix)) {
                toSave[key] = entry;
            }
        }
        try {
            localStorage.setItem(`fyc:${netId}:${prefix}`, JSON.stringify(toSave));
        } catch {
            // localStorage full or unavailable — silently ignore
        }
    }

    // Restore cache entries from localStorage (won't overwrite in-memory data)
    restoreKeys(prefix: string): number {
        const netId = getActiveNetworkId();
        try {
            const raw = localStorage.getItem(`fyc:${netId}:${prefix}`);
            if (!raw) return 0;
            const entries: Record<string, CacheEntry<any>> = JSON.parse(raw);
            let count = 0;
            for (const [key, entry] of Object.entries(entries)) {
                if (!this.cache.has(key)) {
                    this.cache.set(key, entry);
                    count++;
                }
            }
            return count;
        } catch {
            return 0;
        }
    }

    // Clear persisted localStorage for a prefix
    clearPersistedKeys(prefix: string): void {
        const netId = getActiveNetworkId();
        try {
            localStorage.removeItem(`fyc:${netId}:${prefix}`);
        } catch {}
    }
}

// Singleton instance
export const blockchainCache = new BlockchainCache();

// Auto-restore NFT card cache from localStorage on startup (instant load)
const _restored = blockchainCache.restoreKeys('nft:');
if (_restored > 0) {
}

// Export polling intervals for use in hooks
export { POLLING_INTERVALS };

// Cache keys
export const CacheKeys = {
    // Balance data
    balance: (address: string) => `balance:${address}`,

    // Pack data
    packPrice: () => 'pack:price',
    packsSold: () => 'pack:sold',

    // User-specific pack data
    userUnopenedPacks: (address: string) => `pack:unopened:${address}`,
    userPacks: (address: string) => `pack:user:${address}`,

    // NFT data
    ownedTokens: (address: string) => `nft:owned:${address}`,
    cardMetadata: (tokenId: number) => `nft:card:${tokenId}`,
    userCards: (address: string) => `nft:cards:${address}`,

    // Tournament data
    activeTournamentId: () => 'tournament:activeId',
    tournament: (id: number) => `tournament:${id}`,
    allTournaments: () => 'tournament:all',
    canRegister: (id: number) => `tournament:canRegister:${id}`,
    userEntered: (id: number, address: string) => `tournament:entered:${id}:${address}`,
    userLineup: (id: number, address: string) => `tournament:lineup:${id}:${address}`,
    tournamentPhase: (id: number) => `tournament:phase:${id}`,

    // Marketplace data
    activeListings: () => 'marketplace:listings',
    userListings: (address: string) => `marketplace:userListings:${address}`,
    userBids: (address: string) => `marketplace:userBids:${address}`,
    marketplaceStats: () => 'marketplace:stats',
    activeAuctions: () => 'marketplace:auctions',
};

// TTL constants
export const CacheTTL = {
    SHORT: 10 * 1000,     // 10 seconds - for rapidly changing data
    DEFAULT: 30 * 1000,   // 30 seconds - most blockchain data
    LONG: 5 * 60 * 1000,  // 5 minutes - for stable data
    PERMANENT: Infinity,  // Never expires - for immutable data
};
