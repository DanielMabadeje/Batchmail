<?php

namespace App\Services;

use App\Models\MailAccount;
use Illuminate\Support\Collection;

/**
 * Quota accounting.
 *
 * Gmail counts recipients per account on a rolling window rather than
 * resetting at midnight, and it throttles behaviourally well below its
 * published caps. So we track a rolling 24h and 1h count from send_logs and
 * treat the configured caps as ceilings we stay comfortably under, not
 * targets to hit.
 */
class BudgetService
{
    /**
     * How many sends this account can take right now.
     *
     * Returns the smaller of the daily and hourly allowances, since both
     * must hold. Zero means "not now" — which may be temporary (hourly cap)
     * or effectively for the day (daily cap or throttle).
     */
    public function remainingFor(MailAccount $account): int
    {
        if (! $account->isAvailable()) {
            return 0;
        }

        $sentLastDay = $this->countSince($account, now()->subDay());
        $sentLastHour = $this->countSince($account, now()->subHour());

        return max(0, min(
            $account->daily_recipient_cap - $sentLastDay,
            $account->hourly_recipient_cap - $sentLastHour,
        ));
    }

    /**
     * Full budget picture for the UI — the options page renders this as a
     * segmented meter so the user can see quota depleting.
     */
    public function describe(MailAccount $account): array
    {
        $sentLastDay = $this->countSince($account, now()->subDay());
        $sentLastHour = $this->countSince($account, now()->subHour());

        return [
            'daily_cap' => $account->daily_recipient_cap,
            'used_today' => $sentLastDay,
            'daily_remaining' => max(0, $account->daily_recipient_cap - $sentLastDay),
            'hourly_cap' => $account->hourly_recipient_cap,
            'hourly_remaining' => max(0, $account->hourly_recipient_cap - $sentLastHour),
            'throttled_until' => $account->throttled_until?->toIso8601String(),
            'available_now' => $this->remainingFor($account),
        ];
    }

    /**
     * When it is worth asking again. The extension sleeps this long rather
     * than polling — MV3 alarms have a one-minute floor anyway.
     */
    public function retryAfterSeconds(Collection $accounts): int
    {
        $soonest = $accounts
            ->map(fn (MailAccount $account) => $account->throttled_until?->diffInSeconds(now(), absolute: true))
            ->filter()
            ->min();

        // Default to an hour: if every account is out of budget, the hourly
        // window is the next thing that frees up.
        return (int) max(60, $soonest ?? 3600);
    }

    private function countSince(MailAccount $account, \DateTimeInterface $since): int
    {
        return $account->sendLogs()
            ->where('occurred_at', '>=', $since)
            // Rate-limited attempts count too. Gmail saw the request even
            // though it refused it, and pretending otherwise means hammering
            // an account that is already unhappy.
            ->whereIn('outcome', ['sent', 'rate_limited'])
            ->count();
    }
}