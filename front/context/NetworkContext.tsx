// Network context for RISE Chain

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import {
    NetworkConfig,
    getActiveNetwork,
    setActiveNetwork as setModuleNetwork,
    getActiveNetworkId,
    getAllNetworks,
} from '../lib/networks';
import { resetNFTModuleState } from '../hooks/useNFT';

interface NetworkContextType {
    activeNetwork: NetworkConfig;
    networkId: string;
    allNetworks: NetworkConfig[];
    switchNetwork: (id: string) => void;
}

const NetworkContext = createContext<NetworkContextType | null>(null);

export function NetworkProvider({ children }: { children: ReactNode }) {
    const [networkId, setNetworkId] = useState<string>(getActiveNetworkId());

    const switchNetwork = useCallback((id: string) => {
        // Data is shared across networks — no cache reset, no refetch.
        // Only NFT state is per-chain and needs clearing.
        resetNFTModuleState();
        setModuleNetwork(id);
        setNetworkId(id);
        // Components re-render via context; existing subscriptions
        // continue polling and apiUrl() auto-picks up the new base.
    }, []);

    const value: NetworkContextType = {
        activeNetwork: getActiveNetwork(),
        networkId,
        allNetworks: getAllNetworks(),
        switchNetwork,
    };

    return (
        <NetworkContext.Provider value={value}>
            {children}
        </NetworkContext.Provider>
    );
}

export function useNetwork() {
    const context = useContext(NetworkContext);
    if (!context) {
        throw new Error('useNetwork must be used within NetworkProvider');
    }
    return context;
}
