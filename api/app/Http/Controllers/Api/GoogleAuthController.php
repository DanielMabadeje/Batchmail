<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Google OAuth, exchanged server-side.
 *
 * The extension runs the redirect and PKCE, but cannot complete the token
 * exchange: launchWebAuthFlow redirects to chromiumapp.org, which must be
 * registered on a "Web application" OAuth client, and Google requires that
 * client's secret at the token endpoint even with PKCE.
 *
 * So the extension posts the code here and Laravel exchanges it. The secret
 * stays server-side; the resulting Gmail tokens go straight back to the
 * extension and are NOT persisted. The backend still cannot send mail.
 *
 * PKCE is still doing real work: it binds the code to the extension
 * instance that started the flow, so an intercepted code is useless.
 */
class GoogleAuthController extends Controller
{
    private const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

    /**
     * Exchange an authorisation code for tokens, and sign the user in.
     *
     * One call rather than two: the id_token comes back from Google over
     * TLS using our own client credentials, so it needs no separate
     * verification round trip — and there's no window where the extension
     * holds an identity it hasn't yet traded for a session.
     */
    public function exchange(Request $request)
    {
        $validated = $request->validate([
            'code' => ['required', 'string'],
            'code_verifier' => ['required', 'string', 'min:43', 'max:128'],
            'redirect_uri' => ['required', 'string'],
        ]);

        $tokens = $this->callGoogle([
            'grant_type' => 'authorization_code',
            'code' => $validated['code'],
            'code_verifier' => $validated['code_verifier'],
            'redirect_uri' => $validated['redirect_uri'],
        ]);

        if (! isset($tokens['refresh_token'])) {
            throw ValidationException::withMessages([
                'code' => 'Google did not return a refresh token. The authorisation request must include access_type=offline and prompt=consent.',
            ]);
        }

        $claims = $this->claimsFrom($tokens['id_token']);

        $user = User::updateOrCreate(
            ['google_sub' => $claims['sub']],
            [
                'email' => $claims['email'],
                'name' => $claims['name'] ?? $claims['email'],
                // No password login is offered; this fills the column
                // without creating a usable credential.
                'password' => Str::random(64),
            ],
        );

        return response()->json([
            'token' => $user->createToken('batchmail-extension')->plainTextToken,
            'user' => $user->only(['id', 'name', 'email']),
            'account' => [
                'email' => $claims['email'],
                'google_sub' => $claims['sub'],
                'display_name' => $claims['name'] ?? $claims['email'],
            ],
            // Handed back, never stored.
            'google' => [
                'access_token' => $tokens['access_token'],
                'refresh_token' => $tokens['refresh_token'],
                'expires_in' => $tokens['expires_in'],
            ],
        ]);
    }

    /**
     * Mint a fresh access token from a refresh token the extension holds.
     *
     * Authenticated deliberately: a stolen refresh token is useless without
     * a Batchmail session, since the client secret lives only here.
     */
    public function refresh(Request $request)
    {
        $validated = $request->validate([
            'refresh_token' => ['required', 'string'],
        ]);

        $tokens = $this->callGoogle([
            'grant_type' => 'refresh_token',
            'refresh_token' => $validated['refresh_token'],
        ]);

        return response()->json([
            'access_token' => $tokens['access_token'],
            'expires_in' => $tokens['expires_in'],
        ]);
    }

    public function signOut(Request $request)
    {
        $request->user()->currentAccessToken()->delete();

        return response()->noContent();
    }

    private function callGoogle(array $payload): array
    {
        $response = Http::asForm()->post(self::TOKEN_ENDPOINT, [
            'client_id' => config('services.google.client_id'),
            'client_secret' => config('services.google.client_secret'),
            ...$payload,
        ]);

        if ($response->failed()) {
            $error = $response->json('error_description')
                ?? $response->json('error')
                ?? 'Unknown error';

            throw ValidationException::withMessages([
                'code' => "Google rejected the request: {$error}",
            ]);
        }

        return $response->json();
    }

    /**
     * Read the id_token payload without signature verification.
     *
     * Safe here, and only here: this token came straight from Google's token
     * endpoint over TLS in response to our own authenticated request. An
     * id_token arriving from anywhere else must be verified properly.
     */
    private function claimsFrom(string $idToken): array
    {
        $payload = explode('.', $idToken)[1] ?? '';
        $decoded = json_decode(
            base64_decode(strtr($payload, '-_', '+/')),
            associative: true,
        );

        if (! isset($decoded['sub'], $decoded['email'])) {
            throw ValidationException::withMessages([
                'code' => 'Google returned an identity token we could not read.',
            ]);
        }

        if (($decoded['email_verified'] ?? false) !== true) {
            throw ValidationException::withMessages([
                'code' => 'This Google account has no verified email address.',
            ]);
        }

        return $decoded;
    }
}