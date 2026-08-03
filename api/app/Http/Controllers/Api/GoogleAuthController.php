<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Sign-in.
 *
 * The extension already holds a Google ID token from the OAuth flow that
 * granted gmail.send, so we reuse it for identity rather than making the
 * user authenticate twice. One consent, one session.
 */
class GoogleAuthController extends Controller
{
    public function store(Request $request)
    {
        $validated = $request->validate([
            'id_token' => ['required', 'string'],
        ]);

        $claims = $this->verify($validated['id_token']);

        $user = User::updateOrCreate(
            ['google_sub' => $claims['sub']],
            [
                'email' => $claims['email'],
                'name' => $claims['name'] ?? $claims['email'],
                // Local password login is not offered; this satisfies the
                // column without creating a usable credential.
                'password' => Str::random(64),
            ],
        );

        return response()->json([
            'token' => $user->createToken('batchmail-extension')->plainTextToken,
            'user' => $user->only(['id', 'name', 'email']),
        ]);
    }

    public function destroy(Request $request)
    {
        $request->user()->currentAccessToken()->delete();

        return response()->noContent();
    }

    /**
     * Verify against Google's tokeninfo endpoint.
     *
     * Verifying the JWT signature locally against Google's JWKS is faster
     * and avoids a network hop per sign-in, but sign-in is rare and this is
     * far harder to get subtly wrong. Revisit if it ever becomes hot.
     */
    private function verify(string $idToken): array
    {
        $response = Http::get('https://oauth2.googleapis.com/tokeninfo', [
            'id_token' => $idToken,
        ]);

        if ($response->failed()) {
            throw ValidationException::withMessages([
                'id_token' => 'Google rejected this sign-in token.',
            ]);
        }

        $claims = $response->json();

        // Critical: without this check, anyone with a Google token issued to
        // any application could sign in as anyone here.
        if (($claims['aud'] ?? null) !== config('services.google.client_id')) {
            throw ValidationException::withMessages([
                'id_token' => 'This token was issued for a different application.',
            ]);
        }

        if (($claims['email_verified'] ?? 'false') !== 'true') {
            throw ValidationException::withMessages([
                'id_token' => 'This Google account has no verified email address.',
            ]);
        }

        return $claims;
    }
}