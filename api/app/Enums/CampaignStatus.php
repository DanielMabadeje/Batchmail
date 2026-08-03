<?php

namespace App\Enums;

enum CampaignStatus: string
{
    case Draft = 'draft';
    case Ready = 'ready';
    case Sending = 'sending';
    case Paused = 'paused';
    case Completed = 'completed';
    case Cancelled = 'cancelled';

    public function acceptsWork(): bool
    {
        return $this === self::Sending;
    }
}