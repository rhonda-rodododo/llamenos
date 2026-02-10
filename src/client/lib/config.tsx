import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { getConfig } from './api'

interface ConfigContextValue {
  hotlineName: string
  hotlineNumber: string
  isLoading: boolean
}

const ConfigContext = createContext<ConfigContextValue>({ hotlineName: 'Hotline', hotlineNumber: '', isLoading: true })

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [hotlineName, setHotlineName] = useState('Hotline')
  const [hotlineNumber, setHotlineNumber] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    getConfig()
      .then(config => {
        setHotlineName(config.hotlineName)
        setHotlineNumber(config.hotlineNumber || '')
      })
      .finally(() => setIsLoading(false))
  }, [])

  // Set document title
  useEffect(() => {
    if (!isLoading) document.title = hotlineName
  }, [hotlineName, isLoading])

  return (
    <ConfigContext.Provider value={{ hotlineName, hotlineNumber, isLoading }}>
      {children}
    </ConfigContext.Provider>
  )
}

export function useConfig() {
  return useContext(ConfigContext)
}
