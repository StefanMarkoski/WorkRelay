import { createContext, useContext } from 'react'
import type { LiveStatus } from './use-realtime-sync'

/** The realtime connection's state, shared so any card can say whether what it shows is arriving live. */
export const LiveStatusContext = createContext<LiveStatus>('connecting')
export const useLiveStatus = () => useContext(LiveStatusContext)
