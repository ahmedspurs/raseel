/** Formats Saudi riyal amounts in the interface language. */
export function useMoney() {
  const { locale } = useI18n()
  const fmt = computed(
    () =>
      new Intl.NumberFormat(locale.value === 'ar' ? 'ar-SA' : 'en-SA', {
        style: 'currency',
        currency: 'SAR',
        maximumFractionDigits: 0,
      }),
  )
  return (value: number) => fmt.value.format(value)
}
