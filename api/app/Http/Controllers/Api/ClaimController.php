<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Campaign;
use App\Services\ClaimService;
use App\Services\ResultService;
use Illuminate\Http\Request;

class ClaimController extends Controller
{
    public function __construct(
        private ClaimService $claims,
        private ResultService $results,
    ) {}

    public function claim(Request $request, Campaign $campaign)
    {
        $this->authorize('update', $campaign);

        $validated = $request->validate([
            'batch_size' => ['integer', 'min:1', 'max:25'],
        ]);

        return response()->json(
            $this->claims->claim($campaign, $validated['batch_size'] ?? 5)
        );
    }

    public function results(Request $request, Campaign $campaign)
    {
        $this->authorize('update', $campaign);

        $validated = $request->validate([
            'lease_id' => ['required', 'uuid'],
            'results' => ['required', 'array'],
            'results.*.recipient_id' => ['required', 'integer'],
            'results.*.outcome' => ['required', 'in:sent,failed,rate_limited'],
            'results.*.gmail_message_id' => ['nullable', 'string'],
            'results.*.gmail_thread_id' => ['nullable', 'string'],
            'results.*.error_code' => ['nullable', 'string', 'max:100'],
            'results.*.error_message' => ['nullable', 'string', 'max:1000'],
            'results.*.suggested_cooldown_seconds' => ['nullable', 'integer', 'min:0', 'max:86400'],
        ]);

        return response()->json(
            $this->results->record($campaign, $validated['lease_id'], $validated['results'])
        );
    }

    public function state(Campaign $campaign)
    {
        $this->authorize('view', $campaign);

        return response()->json([
            'uuid' => $campaign->uuid,
            'status' => $campaign->status->value,
            'total_count' => $campaign->total_count,
            'sent_count' => $campaign->sent_count,
            'failed_count' => $campaign->failed_count,
            'within_send_window' => $campaign->withinSendWindow(),
        ]);
    }
}