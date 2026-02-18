// Network configuration for RISE Chain

export interface NetworkConfig {
    id: string;
    name: string;
    shortName: string;
    chainId: number;
    rpcUrl: string;
    explorerUrl: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    contracts: {
        UnicornX_NFT: string;
        PackOpener: string;
        TournamentManager: string;
        MarketplaceV2: string;
    };
    apiBase: string;
    metadataBase: string;
    icon: string;
    deployed: boolean;
}

export const NETWORKS: Record<string, NetworkConfig> = {
    rise: {
        id: 'rise',
        name: 'RISE Testnet',
        shortName: 'RISE',
        chainId: 11155931,
        rpcUrl: 'https://testnet.riselabs.xyz',
        explorerUrl: 'https://explorer.testnet.riselabs.xyz',
        nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
        contracts: {
            UnicornX_NFT: '0x0000000000000000000000000000000000000000',
            PackOpener: '0x0000000000000000000000000000000000000000',
            TournamentManager: '0x0000000000000000000000000000000000000000',
            MarketplaceV2: '0x0000000000000000000000000000000000000000',
        },
        apiBase: '/api',
        metadataBase: '/metadata',
        icon: '',
        deployed: true,
    },
};

const DEFAULT_NETWORK = 'rise';

export function getActiveNetwork(): NetworkConfig {
    return NETWORKS[DEFAULT_NETWORK];
}

export function setActiveNetwork(_id: string) {
    // Single chain — no-op
}

export function getActiveNetworkId(): string {
    return DEFAULT_NETWORK;
}

export function getAllNetworks(): NetworkConfig[] {
    return Object.values(NETWORKS);
}

/** Short currency symbol for the active network */
export function currencySymbol(): string {
    return getActiveNetwork().nativeCurrency.symbol;
}
