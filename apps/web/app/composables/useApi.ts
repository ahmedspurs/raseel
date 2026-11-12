import { FetchError } from 'ofetch'

export interface ApiErrorBody {
  error: string
  issues?: { path: string; message: string }[]
}

/** Typed `$fetch` wrapper for the Raseel API. Cookies carry the session. */
export function useApi() {
  return $fetch.create({
    baseURL: '/api',
    credentials: 'include',
    retry: 0,
  })
}

/** Maps an API error to a translated, human-readable message. */
export function useApiError() {
  const { t, te } = useI18n()
  return (err: unknown): string => {
    if (err instanceof FetchError) {
      if (!err.response) return t('errors.network')
      if (err.statusCode === 429) return t('errors.rate_limited')
      const code = (err.data as ApiErrorBody | undefined)?.error
      if (code && te(`errors.${code}`)) return t(`errors.${code}`)
      if (err.statusCode === 403) return t('errors.forbidden')
    }
    return t('errors.generic')
  }
}

export function apiErrorCode(err: unknown): string | undefined {
  return err instanceof FetchError ? (err.data as ApiErrorBody | undefined)?.error : undefined
}
