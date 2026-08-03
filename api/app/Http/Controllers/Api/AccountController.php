<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\MailAccount;
use App\Services\BudgetService;
use Illuminate\Http\Request;

class AccountController extends Controller
{
    public function __construct(private BudgetService $budget) {}

    public function index(Request $request)
    {
        return response()->json(
            $request->user()->mailAccounts->map(fn (MailAccount $account) => [
                'id' => $account->id,
                'email' => $account->email,
                'display_name' => $account->display_name,
                'status' => $account->status->value,
                ...$this->budget->describe($account),
            ])
        );
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'email' => ['required', 'email'],
            'google_sub' => ['required', 'string'],
            'display_name' => ['nullable', 'string', 'max:255'],
        ]);

        // Reconnecting an existing address updates it rather than failing on
        // the unique index — the user experiences this as "reconnect".
        $account = $request->user()->mailAccounts()->updateOrCreate(
            ['email' => $validated['email']],
            [
                'google_sub' => $validated['google_sub'],
                'display_name' => $validated['display_name'] ?? $validated['email'],
                'status' => 'active',
                'throttled_until' => null,
            ],
        );

        return response()->json($account, 201);
    }

    public function budget(Request $request, MailAccount $account)
    {
        $this->authorize('view', $account);

        return response()->json($this->budget->describe($account));
    }

    public function throttle(Request $request, MailAccount $account)
    {
        $this->authorize('update', $account);

        $validated = $request->validate([
            'seconds' => ['required', 'integer', 'min:60', 'max:86400'],
            'reason' => ['nullable', 'string', 'max:255'],
        ]);

        $account->update([
            'throttled_until' => now()->addSeconds($validated['seconds']),
        ]);

        return response()->json($this->budget->describe($account->fresh()));
    }

    public function destroy(Request $request, MailAccount $account)
    {
        $this->authorize('delete', $account);

        $account->delete();

        return response()->noContent();
    }
}