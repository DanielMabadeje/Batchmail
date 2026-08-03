<?php

namespace App\Http\Controllers\Api;

use App\Enums\CampaignStatus;
use App\Enums\RecipientStatus;
use App\Http\Controllers\Controller;
use App\Models\Campaign;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class CampaignController extends Controller
{
    public function index(Request $request)
    {
        return response()->json(
            $request->user()->campaigns()
                ->latest()
                ->paginate(25, [
                    'uuid', 'name', 'status', 'total_count',
                    'sent_count', 'failed_count', 'created_at',
                ])
        );
    }

    public function store(Request $request)
    {
        $validated = $this->validateCampaign($request);

        $campaign = $request->user()->campaigns()->create($validated);
        $campaign->mailAccounts()->sync($validated['mail_account_ids']);

        return response()->json($campaign->load('mailAccounts'), 201);
    }

    public function show(Campaign $campaign)
    {
        $this->authorize('view', $campaign);

        return response()->json($campaign->load('mailAccounts'));
    }

    public function update(Request $request, Campaign $campaign)
    {
        $this->authorize('update', $campaign);

        // Editing a campaign mid-send would mean some recipients got one
        // version and some another. Refuse rather than silently split it.
        if ($campaign->status === CampaignStatus::Sending) {
            throw ValidationException::withMessages([
                'status' => 'Pause the campaign before editing it.',
            ]);
        }

        $validated = $this->validateCampaign($request, partial: true);

        $campaign->update($validated);

        if (isset($validated['mail_account_ids'])) {
            $campaign->mailAccounts()->sync($validated['mail_account_ids']);
        }

        return response()->json($campaign->load('mailAccounts'));
    }

    public function destroy(Campaign $campaign)
    {
        $this->authorize('delete', $campaign);

        $campaign->delete();

        return response()->noContent();
    }

    /**
     * Bulk import. Called in chunks by the extension because a pasted CSV
     * can be thousands of rows.
     *
     * upsert() rather than insert() so re-importing the same list updates
     * merge data instead of exploding on the unique index — and so a user
     * who pastes twice doesn't double their quota burn.
     */
    public function addRecipients(Request $request, Campaign $campaign)
    {
        $this->authorize('update', $campaign);

        if ($campaign->status === CampaignStatus::Sending) {
            throw ValidationException::withMessages([
                'status' => 'Pause the campaign before adding recipients.',
            ]);
        }

        $validated = $request->validate([
            'recipients' => ['required', 'array', 'min:1', 'max:1000'],
            'recipients.*.email' => ['required', 'email:rfc'],
            'recipients.*.name' => ['nullable', 'string', 'max:255'],
            'recipients.*.merge_data' => ['nullable', 'array'],
        ]);

        $now = now();

        $rows = collect($validated['recipients'])
            // Deduplicate within the payload itself — upsert cannot resolve
            // two conflicting rows in the same statement.
            ->uniqueBy(fn (array $row) => Str::lower($row['email']))
            ->map(fn (array $row) => [
                'campaign_id' => $campaign->id,
                'email' => Str::lower($row['email']),
                'name' => $row['name'] ?? null,
                'merge_data' => json_encode($row['merge_data'] ?? []),
                'status' => RecipientStatus::Pending->value,
                'tracking_token' => (string) Str::uuid(),
                'created_at' => $now,
                'updated_at' => $now,
            ])
            ->values()
            ->all();

        $campaign->recipients()->upsert(
            $rows,
            ['campaign_id', 'email'],
            ['name', 'merge_data', 'updated_at'],
        );

        $campaign->refreshCounters();

        return response()->json([
            'imported' => count($rows),
            'total_count' => $campaign->fresh()->total_count,
        ]);
    }

    public function start(Campaign $campaign)
    {
        $this->authorize('update', $campaign);

        if ($campaign->recipients()->where('status', RecipientStatus::Pending)->doesntExist()) {
            throw ValidationException::withMessages([
                'recipients' => 'This campaign has nothing left to send.',
            ]);
        }

        if ($campaign->mailAccounts()->doesntExist()) {
            throw ValidationException::withMessages([
                'mail_account_ids' => 'Connect a Gmail account before sending.',
            ]);
        }

        $campaign->update([
            'status' => CampaignStatus::Sending,
            'started_at' => $campaign->started_at ?? now(),
            'completed_at' => null,
        ]);

        return response()->json(['status' => $campaign->status->value]);
    }

    /**
     * Pausing releases every outstanding lease immediately rather than
     * waiting for expiry, so a resumed campaign starts clean.
     */
    public function pause(Campaign $campaign)
    {
        $this->authorize('update', $campaign);

        $campaign->update(['status' => CampaignStatus::Paused]);

        $campaign->recipients()
            ->where('status', RecipientStatus::Leased)
            ->update([
                'status' => RecipientStatus::Pending->value,
                'lease_id' => null,
                'leased_at' => null,
                'lease_expires_at' => null,
            ]);

        return response()->json(['status' => $campaign->status->value]);
    }

    private function validateCampaign(Request $request, bool $partial = false): array
    {
        $required = $partial ? 'sometimes' : 'required';

        $validated = $request->validate([
            'name' => [$required, 'string', 'max:255'],
            'subject_template' => [$required, 'string', 'max:500'],
            'body_template' => [$required, 'string', 'max:100000'],
            'body_format' => ['sometimes', 'in:html,text'],
            'reply_to' => ['nullable', 'email'],

            // Floors, not defaults. Sending faster than this is how accounts
            // get throttled, so the API refuses rather than trusting the client.
            'min_delay_seconds' => ['sometimes', 'integer', 'min:20', 'max:3600'],
            'max_delay_seconds' => ['sometimes', 'integer', 'min:20', 'max:7200'],

            'window_start' => ['nullable', 'date_format:H:i:s'],
            'window_end' => ['nullable', 'date_format:H:i:s'],
            'timezone' => ['sometimes', 'timezone'],
            'track_opens' => ['sometimes', 'boolean'],
            'track_clicks' => ['sometimes', 'boolean'],

            'mail_account_ids' => [$required, 'array', 'min:1'],
            'mail_account_ids.*' => ['integer', 'exists:mail_accounts,id'],
        ]);

        if (isset($validated['min_delay_seconds'], $validated['max_delay_seconds'])
            && $validated['min_delay_seconds'] > $validated['max_delay_seconds']) {
            throw ValidationException::withMessages([
                'min_delay_seconds' => 'The minimum delay cannot exceed the maximum.',
            ]);
        }

        // Never trust ids from the client — an attacker could otherwise
        // attach someone else's connected account to their own campaign.
        if (isset($validated['mail_account_ids'])) {
            $owned = $request->user()->mailAccounts()
                ->whereIn('id', $validated['mail_account_ids'])
                ->pluck('id');

            if ($owned->count() !== count($validated['mail_account_ids'])) {
                throw ValidationException::withMessages([
                    'mail_account_ids' => 'One of those accounts is not connected to your profile.',
                ]);
            }
        }

        return $validated;
    }
}