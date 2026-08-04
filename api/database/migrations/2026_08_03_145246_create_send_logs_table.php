<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        /**
         * Append-only ledger of every send attempt, across all campaigns.
         *
         * This exists separately from campaign_recipients because quota is a
         * property of the ACCOUNT, not the campaign. Gmail counts recipients
         * per rolling 24h window regardless of which campaign they came from,
         * so budget queries must span everything the account has sent.
         */
        Schema::create('send_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('mail_account_id')->constrained()->cascadeOnDelete();
            $table->foreignId('campaign_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('campaign_recipient_id')->nullable()
                ->constrained()->nullOnDelete();

            $table->enum('outcome', ['sent', 'failed', 'rate_limited']);
            $table->string('error_code')->nullable();
            $table->timestamp('occurred_at');

            // The hot query is:
            //   where mail_account_id = ? and occurred_at > now() - 24h
            $table->index(['mail_account_id', 'occurred_at'], 'send_logs_budget_idx');
        });

        Schema::create('tracking_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('campaign_recipient_id')->constrained()->cascadeOnDelete();
            $table->enum('type', ['open', 'click']);
            $table->text('url')->nullable();

            // Hash rather than store. You do not need the raw IP, and holding
            // it turns a side project into a GDPR conversation.
            $table->string('ip_hash', 64)->nullable();
            $table->string('user_agent_family')->nullable();

            $table->timestamp('occurred_at');

            $table->index(['campaign_recipient_id', 'type']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tracking_events');
        Schema::dropIfExists('send_logs');
    }
};