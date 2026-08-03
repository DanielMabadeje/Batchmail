<?php

namespace App\Services;

use App\Enums\CampaignStatus;
use App\Enums\RecipientStatus;
use App\Models\Campaign;
use App\Models\CampaignRecipient;
use App\Models\MailAccount;
use App\Models\SendLog;
use Illuminate\Support\Facades\DB;

/**
 * Recording what the client did.
 *
 * The backend cannot send and cannot retry — it has no Gmail credential.
 * All it can do is record outcomes accurately and put unfinished work back
 * in the pool for the next pass.
 */
class ResultService
{
    public function record(Campaign $campaign, string $leaseId, array $results): array
    {
        $reported = collect($results)->keyBy('recipient_id');

        DB::transaction(function () use ($campaign, $leaseId, $reported) {
            $leased = $campaign->recipients()
                ->where('lease_id', $leaseId)
                ->lockForUpdate()
                ->get();

            foreach ($leased as $recipient) {
                $result = $reported->get($recipient->id);

                // Not reported means the client stopped before reaching it —
                // lease expiry, browser closed, rate limit hit earlier in the
                // batch. Release it rather than counting it as a failure.
                if (! $result) {
                    $this->release($recipient);
                    continue;
                }

                $this->apply($campaign, $recipient, $result);
            }

            $campaign->refreshCounters();
            $this->completeIfDone($campaign);
        });

        return [
            'campaign_status' => $campaign->fresh()->status->value,
            'sent_count' => $campaign->fresh()->sent_count,
            'failed_count' => $campaign->fresh()->failed_count,
        ];
    }

    private function apply(Campaign $campaign, CampaignRecipient $recipient, array $result): void
    {
        $outcome = $result['outcome'];

        // Every attempt hits the ledger, including rate-limited ones. Gmail
        // saw the request even though it refused it, and not counting it
        // means we immediately hammer an account that is already unhappy.
        SendLog::create([
            'mail_account_id' => $recipient->mail_account_id,
            'campaign_id' => $campaign->id,
            'campaign_recipient_id' => $recipient->id,
            'outcome' => $outcome === 'sent' ? 'sent' : ($outcome === 'rate_limited' ? 'rate_limited' : 'failed'),
            'error_code' => $result['error_code'] ?? null,
            'occurred_at' => now(),
        ]);

        match ($outcome) {
            'sent' => $this->markSent($recipient, $result),
            'rate_limited' => $this->handleRateLimit($recipient, $result),
            default => $this->markFailed($recipient, $result),
        };
    }

    private function markSent(CampaignRecipient $recipient, array $result): void
    {
        $recipient->update([
            'status' => RecipientStatus::Sent,
            'gmail_message_id' => $result['gmail_message_id'] ?? null,
            'gmail_thread_id' => $result['gmail_thread_id'] ?? null,
            'sent_at' => now(),
            'attempts' => $recipient->attempts + 1,
            'lease_id' => null,
            'lease_expires_at' => null,
        ]);

        $recipient->mailAccount?->update(['last_sent_at' => now()]);
    }

    /**
     * Rate limits back off the whole account, never the message.
     *
     * The recipient goes back to pending so it is retried later from a
     * different account or after the cooldown — retrying it immediately is
     * how accounts get suspended rather than merely slowed.
     */
    private function handleRateLimit(CampaignRecipient $recipient, array $result): void
    {
        $this->release($recipient);

        $cooldown = (int) ($result['suggested_cooldown_seconds'] ?? 900);

        $recipient->mailAccount?->update([
            'throttled_until' => now()->addSeconds($cooldown),
        ]);
    }

    private function markFailed(CampaignRecipient $recipient, array $result): void
    {
        $attempts = $recipient->attempts + 1;

        // Two attempts is enough. A third rarely succeeds and every failed
        // send still costs reputation with Gmail.
        $recipient->update([
            'status' => $attempts >= 2 ? RecipientStatus::Failed : RecipientStatus::Pending,
            'error_code' => $result['error_code'] ?? null,
            'error_message' => $result['error_message'] ?? null,
            'attempts' => $attempts,
            'lease_id' => null,
            'lease_expires_at' => null,
        ]);
    }

    private function release(CampaignRecipient $recipient): void
    {
        $recipient->update([
            'status' => RecipientStatus::Pending,
            'lease_id' => null,
            'leased_at' => null,
            'lease_expires_at' => null,
        ]);
    }

    private function completeIfDone(Campaign $campaign): void
    {
        $outstanding = $campaign->recipients()
            ->whereIn('status', [
                RecipientStatus::Pending->value,
                RecipientStatus::Leased->value,
            ])
            ->exists();

        if (! $outstanding && $campaign->status === CampaignStatus::Sending) {
            $campaign->update([
                'status' => CampaignStatus::Completed,
                'completed_at' => now(),
            ]);
        }
    }
}