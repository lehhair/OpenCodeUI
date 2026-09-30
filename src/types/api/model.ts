import type {
  ConfigProvidersResponse as SDKConfigProvidersResponse,
  Model as SDKModel,
  Provider as SDKProvider,
  ProviderAuthAuthorization as SDKProviderAuthAuthorization,
  ProviderAuthMethod as SDKProviderAuthMethod,
} from './v1Model'

export type ModelIOCapabilities = SDKModel['capabilities']['input']

export type ModelCapabilities = SDKModel['capabilities']

export type ModelLimit = SDKModel['limit']

export type ModelStatus = SDKModel['status']

export type Model = SDKModel

export type Provider = SDKProvider

export type ProvidersResponse = SDKConfigProvidersResponse

export type ProviderAuthMethod = SDKProviderAuthMethod

export type ProviderAuthAuthorization = SDKProviderAuthAuthorization
