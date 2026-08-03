<?php

namespace App\Enums;

enum RecipientStatus: string
{
    case Pending = 'pending';
    case Leased = 'leased';
    case Sent = 'sent';
    case Failed = 'failed';
    case Skipped = 'skipped';
}