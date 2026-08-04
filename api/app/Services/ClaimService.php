<?php

namespace App\Services;

use App\Enums\RecipientStatus;
use App\Models\Campaign;
use App\Models\CampaignRecipient;
use App\Models\MailAccount;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Handing work to a client, safely.
 *
 * The hard requirement: if the user has Gmail open in two windows, both
 * extension instances will try to work the same campaign. They must never
 * receive the same recipient. That is enforced here with a row-level lock
 * plus a lease, not with application-level coordination.
 */
class ClaimService
{
    /**
     * How long a client holds claimed work before it returns to the pool.
     *
     * Must comfortably exceed batch_size * max_delay_seconds, or clients
     * lose work mid-batch. Ten minutes covers a batch of 5 at 180s intervals
     * with room to spare.
     */
    private const LEASE_MINUTES = 10;

    public function __construct(private BudgetService $budget) {}

    public function claim(Campaign $campaign, int $batchSize): array
    {
        if (! $campaign->status->acceptsWork()) {
            return $this->nothing(reason: 'campaign_not_sending');
        }

        if (! $campaign->withinSendWindow()) {
            return $this->nothing(reason: 'outside_send_window', retryAfter: 900);
        }

        $accounts = $campaign->mailAccounts()
            ->get()
            ->filter(fn (MailAccount $account) => $account->isAvailable());

        if ($accounts->isEmpty()) {
            return $this->nothing(
                reason: 'no_available_accounts',
                retryAfter: $this->budget->retryAfterSeconds($campaign->mailAccounts()->get()),
            );
        }

        // Budget is the real constraint on batch size, not what the client
        // asked for. Never hand out more than the accounts can absorb.
        $budgets = $accounts->mapWithKeys(fn (MailAccount $account) => [
            $account->id => $this->budget->remainingFor($account),
        ]);

        $available = (int) $budgets->sum();

        if ($available === 0) {
            return $this->nothing(
                reason: 'no_budget',
                retryAfter: $this->budget->retryAfterSeconds($accounts),
            );
        }

        $take = min($batchSize, $available);
        $leaseId = (string) Str::uuid();

        $recipients = DB::transaction(
            fn () => $this->leaseRows($campaign, $take, $leaseId)
        );

        if ($recipients->isEmpty()) {
            // Nothing pending. Either another client took the last of it, or
            // the campaign is finished — the caller checks which.
            return $this->nothing(reason: 'no_pending_recipients');
        }

        $this->assignAccounts($recipients, $accounts, $budgets);

        return [
            'lease_id' => $leaseId,
            'lease_expires_at' => now()->addMinutes(self::LEASE_MINUTES)->toIso8601String(),
            'campaign' => $this->campaignPayload($campaign),
            'recipients' => $recipients->map(fn (CampaignRecipient $r) => [
                'id' => $r->id,
                'email' => $r->email,
                'name' => $r->name,
                'merge_data' => $r->merge_data ?? [],
                'tracking_token' => $r->tracking_token,
                'mail_account_id' => $r->mail_account_id,
                'from_email' => $accounts->firstWhere('id', $r->mail_account_id)?->email,
            ])->values()->all(),
        ];
    }

    /**
     * Lock and lease in one transaction.
     *
     * SKIP LOCKED is what makes concurrent claims safe: a second client
     * hitting this at the same moment steps over the locked rows instead of
     * blocking on them, and gets a different set. Expired leases are treated
     * as claimable, which is why a crashed client needs no cleanup job.
     */
    private function leaseRows(Campaign $campaign, int $take, string $leaseId): Collection
    {
        $ids = DB::table('campaign_recipients')
            ->where('campaign_id', $campaign->id)
            ->where(function ($query) {
                $query->where('status', RecipientStatus::Pending->value)
                    ->orWhere(function ($q) {
                        $q->where('status', RecipientStatus::Leased->value)
                            ->where('lease_expires_at', '<', now());
                    });
            })
            ->orderBy('id')
            ->limit($take)
            ->lock('for update skip locked')
            ->pluck('id');

        if ($ids->isEmpty()) {
            return collect();
        }

        CampaignRecipient::whereIn('id', $ids)->update([
            'status' => RecipientStatus::Leased->value,
            'lease_id' => $leaseId,
            'leased_at' => now(),
            'lease_expires_at' => now()->addMinutes(self::LEASE_MINUTES),
        ]);

        return CampaignRecipient::whereIn('id', $ids)->orderBy('id')->get();
    }

    /**
     * Spread the batch across accounts proportional to remaining budget.
     *
     * Weighting by budget rather than round-robin means a nearly-exhausted
     * account gets fewer sends instead of being the first to hit its ceiling
     * and stall the campaign.
     */
    private function assignAccounts(
        Collection $recipients,
        Collection $accounts,
        Collection $budgets,
    ): void {
        $pool = $budgets->filter(fn (int $remaining) => $remaining > 0)->all();

        foreach ($recipients as $recipient) {
            // Pick whichever account currently has the most headroom.
            arsort($pool);
            $accountId = array_key_first($pool);

            if ($accountId === null) {
                break;
            }

            $recipient->mail_account_id = $accountId;
            $recipient->save();

            if (--$pool[$accountId] <= 0) {
                unset($pool[$accountId]);
            }
        }
    }

    private function campaignPayload(Campaign $campaign): array
    {
        return [
            'uuid' => $campaign->uuid,
            'subject_template' => $campaign->subject_template,
            'body_template' => $campaign->body_template,
            'body_format' => $campaign->body_format,
            'reply_to' => $campaign->reply_to,
            'min_delay_seconds' => $campaign->min_delay_seconds,
            'max_delay_seconds' => $campaign->max_delay_seconds,
            'track_opens' => $campaign->track_opens,
            'track_clicks' => $campaign->track_clicks,
            'tracking_base' => rtrim(config('app.url'), '/'),
        ];
    }

    private function nothing(string $reason, ?int $retryAfter = null): array
    {
        return [
            'lease_id' => null,
            'recipients' => [],
            'reason' => $reason,
            'retry_after_seconds' => $retryAfter,
        ];
    }
}