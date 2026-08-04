<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * One row per intended send.
 *
 * This table is the source of truth for campaign progress. The extension
 * holds no local queue — it asks for work, sends it, reports back. If the
 * browser closes mid-campaign, nothing is lost because nothing was only ever
 * in memory.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('campaign_recipients', function (Blueprint $table) {
            $table->id();
            $table->foreignId('campaign_id')->constrained()->cascadeOnDelete();

            $table->string('email');
            $table->string('name')->nullable();
            $table->json('merge_data')->nullable()
                ->comment('Arbitrary columns from the CSV, referenced as {{key}}');

            $table->enum('status', [
                'pending',
                'leased',
                'sent',
                'failed',
                'skipped',
            ])->default('pending');

            // --- Lease / claim mechanism -------------------------------
            // A client claims a batch by setting these three columns in a
            // single atomic UPDATE. Expired leases fall back to pending, so a
            // crashed tab self-heals without a cleanup job.
            $table->uuid('lease_id')->nullable();
            $table->timestamp('leased_at')->nullable();
            $table->timestamp('lease_expires_at')->nullable();

            // --- Result ------------------------------------------------
            $table->foreignId('mail_account_id')->nullable()
                ->constrained()->nullOnDelete();
            $table->string('gmail_message_id')->nullable();
            $table->string('gmail_thread_id')->nullable();
            $table->unsignedTinyInteger('attempts')->default(0);
            $table->string('error_code')->nullable();
            $table->text('error_message')->nullable();
            $table->timestamp('sent_at')->nullable();

            // Opaque per-recipient token for the tracking pixel and link
            // redirects. Never expose the recipient id itself.
            $table->uuid('tracking_token')->unique();

            $table->timestamps();

            $table->unique(['campaign_id', 'email']);

            // The claim query: pending rows, or leased rows whose lease has
            // expired, ordered by id.
            $table->index(['campaign_id', 'status', 'lease_expires_at'], 'recipients_claim_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('campaign_recipients');
    }
};