<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Connected Gmail addresses.
 *
 * NOTE: this table deliberately stores NO OAuth tokens. In the client-side
 * sending model the extension holds the access/refresh token in
 * chrome.storage and calls the Gmail API directly. The backend only needs to
 * know which addresses exist so it can do quota accounting across them.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('mail_accounts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();

            $table->string('email');
            $table->string('google_sub')->comment('Google account subject claim');
            $table->string('display_name')->nullable();

            // Quota ceilings. Defaults are conservative; the extension can
            // raise these once it detects a Workspace account.
            $table->unsignedInteger('daily_recipient_cap')->default(400);
            $table->unsignedInteger('hourly_recipient_cap')->default(15);

            $table->enum('status', ['active', 'paused', 'throttled', 'revoked'])
                ->default('active');
            $table->timestamp('throttled_until')->nullable()
                ->comment('Set when Gmail returns a rate-limit error');
            $table->timestamp('last_sent_at')->nullable();

            $table->timestamps();

            $table->unique(['user_id', 'email']);
            $table->index(['user_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('mail_accounts');
    }
};