<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('campaigns', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();

            $table->string('name');
            $table->string('subject_template');
            $table->longText('body_template');
            $table->enum('body_format', ['html', 'text'])->default('html');
            $table->string('reply_to')->nullable();

            $table->enum('status', [
                'draft',
                'ready',
                'sending',
                'paused',
                'completed',
                'cancelled',
            ])->default('draft');

            // Pacing. The extension sleeps a random interval in this range
            // between sends so the pattern does not look mechanical.
            $table->unsignedInteger('min_delay_seconds')->default(45);
            $table->unsignedInteger('max_delay_seconds')->default(180);

            // Optional send window, stored in the user's timezone.
            $table->time('window_start')->nullable();
            $table->time('window_end')->nullable();
            $table->string('timezone')->default('UTC');

            $table->boolean('track_opens')->default(false);
            $table->boolean('track_clicks')->default(false);

            // Denormalised counters, updated as results come in. Cheap reads
            // for the dashboard without aggregating the recipients table.
            $table->unsignedInteger('total_count')->default(0);
            $table->unsignedInteger('sent_count')->default(0);
            $table->unsignedInteger('failed_count')->default(0);

            $table->timestamp('started_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'status']);
        });

        // Which accounts this campaign may send from. More than one enables
        // round-robin rotation, which is the only real way past Gmail's caps.
        Schema::create('campaign_mail_account', function (Blueprint $table) {
            $table->id();
            $table->foreignId('campaign_id')->constrained()->cascadeOnDelete();
            $table->foreignId('mail_account_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('weight')->default(1);

            $table->unique(['campaign_id', 'mail_account_id'], 'campaign_account_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('campaign_mail_account');
        Schema::dropIfExists('campaigns');
    }
};