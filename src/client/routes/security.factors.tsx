import { IdleLockSection } from '@/components/user-sections/idle-lock-section'
import { PinChangeSection } from '@/components/user-sections/pin-change-section'
import { RecoveryRotateSection } from '@/components/user-sections/recovery-rotate-section'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/security/factors')({
  component: FactorsPage,
})

function FactorsPage() {
  return (
    <div className="space-y-8" data-testid="factors-page">
      <PinChangeSection />
      <RecoveryRotateSection />
      <IdleLockSection />
    </div>
  )
}
