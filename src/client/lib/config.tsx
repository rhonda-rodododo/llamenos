import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { getConfig } from './api'

interface ConfigContextValue {
  hotlineName: string
  isLoading: boolean
}

const ConfigContext = createContext<ConfigContextValue>({ hotlineName: 'Hotline', isLoading: true })

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [hotlineName, setHotlineName] = useState('Hotline')
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    getConfig()
      .then(config => setHotlineName(config.hotlineName))
      .finally(() => setIsLoading(false))
  }, [])

  // Set document title
  useEffect(() => {
    if (!isLoading) document.title = hotlineName
  }, [hotlineName, isLoading])

  return (
    <ConfigContext.Provider value={{ hotlineName, isLoading }}>
      {children}
    </ConfigContext.Provider>
  )
}

export function useConfig() {
  return useContext(ConfigContext)
}
