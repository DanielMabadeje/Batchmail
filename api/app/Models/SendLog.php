<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Append-only record of every send attempt across all campaigns.
 *
 * Quota belongs to the account, not the campaign — Gmail counts recipients
 * per account per rolling window regardless of which campaign they came
 * from. Counting anywhere else lets two concurrent campaigns spend the same
 * allowance twice.
 */
class SendLog extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'mail_account_id',
        'campaign_id',
        'campaign_recipient_id',
        'outcome',
        'error_code',
        'occurred_at',
    ];

    protected function casts(): array
    {
        return ['occurred_at' => 'datetime'];
    }

    public function mailAccount(): BelongsTo
    {
        return $this->belongsTo(MailAccount::class);
    }
}