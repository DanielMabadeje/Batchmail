<?php

use App\Http\Controllers\Api\AccountController;
use App\Http\Controllers\Api\CampaignController;
use App\Http\Controllers\Api\ClaimController;
use App\Http\Controllers\Api\GoogleAuthController;
use Illuminate\Support\Facades\Route;

Route::post('auth/google', [GoogleAuthController::class, 'store']);

Route::middleware('auth:sanctum')->group(function () {
    Route::delete('auth/session', [GoogleAuthController::class, 'destroy']);

    Route::get('accounts', [AccountController::class, 'index']);
    Route::post('accounts', [AccountController::class, 'store']);
    Route::get('accounts/{account}/budget', [AccountController::class, 'budget']);
    Route::post('accounts/{account}/throttle', [AccountController::class, 'throttle']);
    Route::delete('accounts/{account}', [AccountController::class, 'destroy']);

    Route::apiResource('campaigns', CampaignController::class);
    Route::post('campaigns/{campaign}/recipients', [CampaignController::class, 'addRecipients']);
    Route::post('campaigns/{campaign}/start', [CampaignController::class, 'start']);
    Route::post('campaigns/{campaign}/pause', [CampaignController::class, 'pause']);

    // The send loop. These three are the hot path — everything else is CRUD.
    Route::get('campaigns/{campaign}/state', [ClaimController::class, 'state']);
    Route::post('campaigns/{campaign}/claim', [ClaimController::class, 'claim'])
        // A client hammering claim is either buggy or malicious; either way
        // it burns database locks. The send loop needs nowhere near this.
        ->middleware('throttle:60,1');
    Route::post('campaigns/{campaign}/results', [ClaimController::class, 'results']);
});