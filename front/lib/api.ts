// API base URL helper for RISE Chain

import { getActiveNetwork } from './networks';

/**
 * Returns the full API URL for a given path.
 * Usage: fetch(apiUrl('/tournaments/active'))
 * Result: /api/tournaments/active
 */
export function apiUrl(path: string): string {
    return `${getActiveNetwork().apiBase}${path}`;
}

/**
 * Returns the full metadata URL for a token.
 * Usage: fetch(metadataUrl(`/${tokenId}`))
 * Result: /metadata/1
 */
export function metadataUrl(path: string): string {
    return `${getActiveNetwork().metadataBase}${path}`;
}
