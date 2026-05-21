import { useLocalStorage } from 'foxact/use-local-storage'

import { DEFAULT_BASE_URL, DEFAULT_MODEL } from '../utils/const'

export const useLLMSettings = () => {
  const [baseURL, setBaseURL] = useLocalStorage('apeira:copilotkit:base-url', DEFAULT_BASE_URL)
  const [apiKey, setApiKey] = useLocalStorage('apeira:copilotkit:api-key', '')
  const [model, setModel] = useLocalStorage('apeira:copilotkit:model', DEFAULT_MODEL)

  return { apiKey, baseURL, model, setApiKey, setBaseURL, setModel }
}
