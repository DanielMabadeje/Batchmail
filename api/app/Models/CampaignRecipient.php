<?php

namespace App\Models;

use App\Enums\RecipientStatus;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

class CampaignRecipient extends Model
{
    protected $fillable = ['email', 'name', 'merge_data'];

    protected function casts(): array
    {
        return [
            'status' => RecipientStatus::class,
            'merge_data' => 'array',
            'leased_at' => 'datetime',
            'lease_expires_at' => 'datetime',
            'sent_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (self $recipient) {
            $recipient->tracking_token ??= (string) Str::uuid();
        });
    }

    public function campaign(): BelongsTo
    {
        return $this->belongsTo(Campaign::class);
    }

    public function mailAccount(): BelongsTo
    {
        return $this->belongsTo(MailAccount::class);
    }
}