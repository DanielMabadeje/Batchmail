<?php

namespace App\Models;

use App\Enums\AccountStatus;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A connected Gmail address.
 *
 * Holds no OAuth tokens by design — the extension keeps those locally and
 * calls the Gmail API itself. This record exists so quota can be accounted
 * for across campaigns, which is something only the server can do reliably.
 */
class MailAccount extends Model
{
    protected $fillable = [
        'email',
        'google_sub',
        'display_name',
        'daily_recipient_cap',
        'hourly_recipient_cap',
        'status',
        'throttled_until',
        'last_sent_at',
    ];

    protected function casts(): array
    {
        return [
            'status' => AccountStatus::class,
            'throttled_until' => 'datetime',
            'last_sent_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function sendLogs(): HasMany
    {
        return $this->hasMany(SendLog::class);
    }

    public function isThrottled(): bool
    {
        return $this->throttled_until !== null
            && $this->throttled_until->isFuture();
    }

    public function isAvailable(): bool
    {
        return $this->status === AccountStatus::Active && ! $this->isThrottled();
    }
}
