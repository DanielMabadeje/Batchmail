<?php

namespace App\Models;

use App\Enums\CampaignStatus;
use App\Enums\RecipientStatus;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Campaign extends Model
{
    use HasUuids;

    protected $fillable = [
        'name',
        'subject_template',
        'body_template',
        'body_format',
        'reply_to',
        'min_delay_seconds',
        'max_delay_seconds',
        'window_start',
        'window_end',
        'timezone',
        'track_opens',
        'track_clicks',
    ];

    protected function casts(): array
    {
        return [
            'status' => CampaignStatus::class,
            'track_opens' => 'boolean',
            'track_clicks' => 'boolean',
            'started_at' => 'datetime',
            'completed_at' => 'datetime',
        ];
    }

    /** The route key is the uuid — never expose sequential ids. */
    public function getRouteKeyName(): string
    {
        return 'uuid';
    }

    public function uniqueIds(): array
    {
        return ['uuid'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function recipients(): HasMany
    {
        return $this->hasMany(CampaignRecipient::class);
    }

    public function mailAccounts(): BelongsToMany
    {
        return $this->belongsToMany(MailAccount::class)->withPivot('weight');
    }

    /**
     * Is the campaign inside its allowed sending window?
     *
     * A null window means "any time". Windows that wrap midnight are treated
     * as spanning the boundary rather than as an empty range.
     */
    public function withinSendWindow(): bool
    {
        if (! $this->window_start || ! $this->window_end) {
            return true;
        }

        $now = now($this->timezone)->format('H:i:s');
        $start = $this->window_start;
        $end = $this->window_end;

        return $start <= $end
            ? ($now >= $start && $now <= $end)
            : ($now >= $start || $now <= $end);
    }

    /** Recompute counters from the recipients table — the trustworthy number. */
    public function refreshCounters(): void
    {
        $counts = $this->recipients()
            ->selectRaw('status, count(*) as total')
            ->groupBy('status')
            ->pluck('total', 'status');

        $this->update([
            'total_count' => $counts->sum(),
            'sent_count' => $counts[RecipientStatus::Sent->value] ?? 0,
            'failed_count' => $counts[RecipientStatus::Failed->value] ?? 0,
        ]);
    }
}